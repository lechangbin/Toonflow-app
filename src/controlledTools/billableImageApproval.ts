import { createHash } from "node:crypto";

import type { Knex } from "knex";

import {
  AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
  canonicalCheckpointPayload,
  hashCheckpointPayload,
  type AgentRunCheckpointPayload,
} from "@/agentRuntime";
import type { DatabaseWork } from "@/database";

import { BILLABLE_IMAGE_TOOL_DEFINITION, toolDefinitionContractHash } from "./definitions";
import { billableImageScopeHash, billableImageScopeSchema, type BillableImageScope } from "./billableImageLifecycle";
import { BILLABLE_IMAGE_RUN_ROLE, BILLABLE_IMAGE_RUN_SCOPE, BillableImageLedgerConflictError } from "./billableImageLedger";

const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
export const BILLABLE_IMAGE_APPROVAL_TTL_MS = 10 * 60_000;

export interface BillableImageTarget {
  projectId: number;
  assetId: number;
  vendorId: string;
  modelId: string;
  resolution: string;
}

export interface BillableImageQuote {
  estimatedMaxCostMicros: number;
  currency: string;
}

export interface BillableImagePreflight {
  targetStateHash: string;
  preview: { assetId: number; assetName: string; vendorId: string; modelId: string;
    resolution: string; estimatedMaxCostMicros: number; currency: string; disclaimer: string };
}

export interface BillableImageApprovalDependencies {
  work: DatabaseWork;
  now(): number;
  createId(): string;
  /** The estimate comes from a server-side policy/catalogue, not an Agent or browser claim. */
  quote(target: BillableImageTarget): Promise<BillableImageQuote>;
  /** Checks Project/Asset ownership, current prompt/reference/media readiness and Vendor/Model configuration. */
  preflight(tx: Knex.Transaction, scope: BillableImageScope): Promise<BillableImagePreflight>;
  approvalTtlMs?: number;
}

export interface ProposeBillableImageInput extends BillableImageTarget {
  actorUserId: number;
  clientRequestId: string;
  operationId: string;
}

export interface DecideBillableImageInput {
  projectId: number;
  actorUserId: number;
  runId: string;
  approvalId: string;
  clientCommandId: string;
  expectedVersion: number;
  decision: "approve" | "reject";
}

export interface BillableImageApprovalSnapshot {
  id: string;
  runId: string;
  receiptId: string;
  operationId: string;
  status: "pending" | "approved" | "rejected" | "expired" | "conflicted";
  runVersion: number;
  runStatus: string;
  allowedActions: string[];
  expiresAt: number;
  scopeHash: string;
  contractHash: string;
  preview: BillableImagePreflight["preview"];
}

export async function expireDueBillableImageApprovals(
  db: Knex, projectId: number | null, now: number, createId: () => string,
): Promise<void> {
  const candidates = db("o_agentToolApproval as approval")
    .join("o_agentRun as run", "run.id", "approval.runId")
    .where("run.role", BILLABLE_IMAGE_RUN_ROLE).where("run.scope", BILLABLE_IMAGE_RUN_SCOPE)
    .whereIn("approval.status", ["pending", "approved"]).where("approval.expiresAt", "<=", now)
    .whereNotExists(db("o_agentToolCall as call").select(db.raw("1"))
      .whereRaw("call.approvalId = approval.id"))
    .select("approval.id");
  if (projectId !== null) candidates.where("run.projectId", projectId);
  for (const candidate of await candidates) {
    await db.transaction(async (tx) => {
      const approval = await tx("o_agentToolApproval as approval")
        .join("o_agentRun as run", "run.id", "approval.runId")
        .where("approval.id", candidate.id).where("run.role", BILLABLE_IMAGE_RUN_ROLE)
        .where("run.scope", BILLABLE_IMAGE_RUN_SCOPE)
        .whereIn("approval.status", ["pending", "approved"])
        .where("approval.expiresAt", "<=", now)
        .select("approval.id", "approval.runId", "approval.receiptId", "run.version", "run.projectId")
        .first();
      if (!approval || (projectId !== null && approval.projectId !== projectId)
        || await tx("o_agentToolCall").where({ approvalId: approval.id }).first("id")) return;
      const changed = await tx("o_agentToolApproval").where("id", approval.id)
        .whereIn("status", ["pending", "approved"]).update({ status: "expired" });
      const changedRun = await tx("o_agentRun").where({ id: approval.runId, version: approval.version }).update({
        status: "waiting", waitingReason: "tool-approval-expired", attentionReason: "new-approval-required",
        allowedActions: JSON.stringify(["inspect"]), version: approval.version + 1, updatedAt: now,
      });
      if (changed !== 1 || changedRun !== 1) conflict();
      await tx("o_agentToolReceipt").where({ id: approval.receiptId, status: "pending" })
        .update({ status: "cancelled", updatedAt: now });
      await tx("o_agentRunStep").where({ runId: approval.runId }).update({ status: "waiting" });
      await tx("o_agentRunAttempt").where({ runId: approval.runId }).update({ status: "waiting" });
      const latest = await tx("o_agentTrace").where({ runId: approval.runId })
        .max<{ sequence?: number }>("sequence as sequence").first();
      await tx("o_agentTrace").insert({ id: createId(), runId: approval.runId,
        toolReceiptId: approval.receiptId, sequence: Number(latest?.sequence ?? 0) + 1,
        eventType: "tool.billing-approval.expired", runStatus: "waiting", stepStatus: "waiting", createdAt: now });
    });
  }
}

function conflict(): never { throw new BillableImageLedgerConflictError(); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function targetOf(input: ProposeBillableImageInput): BillableImageTarget {
  return { projectId: input.projectId, assetId: input.assetId, vendorId: input.vendorId,
    modelId: input.modelId, resolution: input.resolution };
}

async function owner(tx: Knex | Knex.Transaction, projectId: number, actorUserId: number): Promise<void> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Number.isSafeInteger(actorUserId) || actorUserId <= 0
    || !(await tx("o_project").where({ id: projectId, userId: actorUserId }).first("id"))) conflict();
}

async function snapshot(tx: Knex | Knex.Transaction, projectId: number, runId: string): Promise<BillableImageApprovalSnapshot | null> {
  const run = await tx("o_agentRun").where({ id: runId, projectId, role: BILLABLE_IMAGE_RUN_ROLE,
    scope: BILLABLE_IMAGE_RUN_SCOPE }).first();
  if (!run) return null;
  const approval = await tx("o_agentToolApproval").where({ runId }).first();
  if (!approval) return null;
  let preview: BillableImagePreflight["preview"];
  try { preview = JSON.parse(approval.previewJson); } catch { return conflict(); }
  return { id: approval.id, runId, receiptId: approval.receiptId, operationId: approval.operationId,
    status: approval.status, runVersion: run.version, runStatus: run.status,
    allowedActions: JSON.parse(run.allowedActions), expiresAt: approval.expiresAt,
    scopeHash: approval.payloadHash, contractHash: approval.contractHash, preview };
}

function assertScope(value: unknown): BillableImageScope {
  const parsed = billableImageScopeSchema.safeParse(value);
  if (!parsed.success || parsed.data.estimatedMaxCostMicros <= 0) return conflict();
  return parsed.data;
}

export function createBillableImageApprovalRuntime(dependencies: BillableImageApprovalDependencies) {
  return {
    async propose(input: ProposeBillableImageInput): Promise<BillableImageApprovalSnapshot> {
      if (!IDENTIFIER.test(input.clientRequestId) || !IDENTIFIER.test(input.operationId)) return conflict();
      const ttl = dependencies.approvalTtlMs ?? BILLABLE_IMAGE_APPROVAL_TTL_MS;
      if (!Number.isSafeInteger(ttl) || ttl <= 0) return conflict();
      return dependencies.work(async (db) => {
        await owner(db, input.projectId, input.actorUserId);
        const prior = await db("o_agentRun").where({ projectId: input.projectId,
          role: BILLABLE_IMAGE_RUN_ROLE, scope: BILLABLE_IMAGE_RUN_SCOPE,
          clientRequestId: input.clientRequestId }).first();
        if (prior) {
          const stored = await db("o_agentToolApproval").where({ runId: prior.id, operationId: input.operationId }).first();
          let raw: unknown;
          try { raw = JSON.parse(stored?.payloadJson); } catch { return conflict(); }
          const original = assertScope(raw);
          if (!stored || JSON.stringify(targetOf(input)) !== JSON.stringify({ projectId: original.projectId,
            assetId: original.assetId, vendorId: original.vendorId, modelId: original.modelId,
            resolution: original.resolution }) || billableImageScopeHash(original) !== stored.payloadHash) return conflict();
          await expireDueBillableImageApprovals(db, input.projectId, dependencies.now(), dependencies.createId);
          return (await snapshot(db, input.projectId, prior.id)) ?? conflict();
        }
        const quote = await dependencies.quote(targetOf(input));
        const scope = assertScope({ ...targetOf(input), ...quote, maxCalls: 1 });
        const scopeHash = billableImageScopeHash(scope);
        const contractHash = toolDefinitionContractHash(BILLABLE_IMAGE_TOOL_DEFINITION);
        const requestFingerprint = hash(JSON.stringify({ role: BILLABLE_IMAGE_RUN_ROLE, scope: BILLABLE_IMAGE_RUN_SCOPE,
          actorUserId: input.actorUserId, operationId: input.operationId, toolRevision: BILLABLE_IMAGE_TOOL_DEFINITION.revision,
          scopeHash }));
        await expireDueBillableImageApprovals(db, input.projectId, dependencies.now(), dependencies.createId);
        return db.transaction(async (tx) => {
        const existing = await tx("o_agentRun").where({ projectId: input.projectId, role: BILLABLE_IMAGE_RUN_ROLE,
          scope: BILLABLE_IMAGE_RUN_SCOPE, clientRequestId: input.clientRequestId }).first();
        if (existing) {
          if (existing.requestFingerprint !== requestFingerprint) return conflict();
          return (await snapshot(tx, input.projectId, existing.id)) ?? conflict();
        }
        const preflight = await dependencies.preflight(tx, scope);
        if (!/^[a-f0-9]{64}$/.test(preflight.targetStateHash)
          || preflight.preview.assetId !== scope.assetId || preflight.preview.vendorId !== scope.vendorId
          || preflight.preview.modelId !== scope.modelId || preflight.preview.resolution !== scope.resolution
          || preflight.preview.estimatedMaxCostMicros !== scope.estimatedMaxCostMicros
          || preflight.preview.currency !== scope.currency || preflight.preview.disclaimer.length === 0) return conflict();
        const now = dependencies.now();
        const catalog = await tx("o_agentToolDefinition").where({ name: BILLABLE_IMAGE_TOOL_DEFINITION.name,
          revision: BILLABLE_IMAGE_TOOL_DEFINITION.revision }).first();
        if (catalog && catalog.contractHash !== contractHash) return conflict();
        if (!catalog) await tx("o_agentToolDefinition").insert({ id: dependencies.createId(),
          name: BILLABLE_IMAGE_TOOL_DEFINITION.name, revision: BILLABLE_IMAGE_TOOL_DEFINITION.revision,
          contractHash, policy: JSON.stringify(BILLABLE_IMAGE_TOOL_DEFINITION.policy), createdAt: now });
        const runId = dependencies.createId();
        const stepId = dependencies.createId();
        const attemptId = dependencies.createId();
        const receiptId = dependencies.createId();
        const approvalId = dependencies.createId();
        await tx("o_agentRun").insert({ id: runId, projectId: scope.projectId, role: BILLABLE_IMAGE_RUN_ROLE,
          scope: BILLABLE_IMAGE_RUN_SCOPE, clientRequestId: input.clientRequestId, requestFingerprint,
          input: JSON.stringify({ operationId: input.operationId, scopeHash }), status: "waiting",
          waitingReason: "tool-approval", attentionReason: "tool-approval-required",
          allowedActions: JSON.stringify(["inspect", "approve", "reject"]), version: 1,
          createdAt: now, updatedAt: now, startedAt: now, fence: 0 });
        await tx("o_agentRunStep").insert({ id: stepId, runId, ordinal: 1, kind: "tool",
          logicalTarget: JSON.stringify({ kind: "tool", name: BILLABLE_IMAGE_TOOL_DEFINITION.name }),
          promptFingerprint: requestFingerprint, status: "waiting", startedAt: now });
        await tx("o_agentRunAttempt").insert({ id: attemptId, runId, stepId, ordinal: 1,
          reason: "initial", status: "waiting", createdAt: now, startedAt: now });
        await tx("o_agentToolReceipt").insert({ id: receiptId, runId, operationId: input.operationId,
          toolName: BILLABLE_IMAGE_TOOL_DEFINITION.name, toolRevision: BILLABLE_IMAGE_TOOL_DEFINITION.revision,
          inputHash: scopeHash, status: "pending", createdAt: now, updatedAt: now });
        await tx("o_agentToolApproval").insert({ id: approvalId, runId, receiptId,
          operationId: input.operationId, toolRevision: BILLABLE_IMAGE_TOOL_DEFINITION.revision,
          contractHash, payloadJson: JSON.stringify(scope), payloadHash: scopeHash,
          targetStateHash: preflight.targetStateHash, previewJson: JSON.stringify(preflight.preview),
          status: "pending", expiresAt: now + ttl, createdAt: now });
        const checkpoint: AgentRunCheckpointPayload = { schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
          kind: "run-created", runId, stepId, attemptId, sequence: 1, runVersion: 1,
          lastCommittedStepId: null, predecessorCheckpointId: null, predecessorPayloadHash: null,
          requestFingerprint };
        await tx("o_agentRunCheckpoint").insert({ id: dependencies.createId(), runId, stepId, attemptId,
          sequence: 1, kind: "run-created", schemaVersion: checkpoint.schemaVersion, runVersion: 1,
          payload: canonicalCheckpointPayload(checkpoint), payloadHash: hashCheckpointPayload(checkpoint), createdAt: now });
        await tx("o_agentTrace").insert({ id: dependencies.createId(), runId, stepId, toolReceiptId: receiptId,
          sequence: 1, eventType: "tool.billing-approval.requested", runStatus: "waiting", stepStatus: "waiting", createdAt: now });
        return (await snapshot(tx, input.projectId, runId)) ?? conflict();
        });
      });
    },

    async inspect(projectId: number, runId: string, actorUserId: number): Promise<BillableImageApprovalSnapshot | null> {
      return dependencies.work(async (db) => { await owner(db, projectId, actorUserId);
        await expireDueBillableImageApprovals(db, projectId, dependencies.now(), dependencies.createId);
        return snapshot(db, projectId, runId); });
    },

    async decide(input: DecideBillableImageInput): Promise<BillableImageApprovalSnapshot | null> {
      if (!IDENTIFIER.test(input.clientCommandId) || !["approve", "reject"].includes(input.decision)
        || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion <= 0) return conflict();
      return dependencies.work(async (db) => {
        await owner(db, input.projectId, input.actorUserId);
        await expireDueBillableImageApprovals(db, input.projectId, dependencies.now(), dependencies.createId);
        return db.transaction(async (tx) => {
        const run = await tx("o_agentRun").where({ id: input.runId, projectId: input.projectId,
          role: BILLABLE_IMAGE_RUN_ROLE, scope: BILLABLE_IMAGE_RUN_SCOPE }).first();
        if (!run) return null;
        const approval = await tx("o_agentToolApproval").where({ id: input.approvalId, runId: run.id }).first();
        if (!approval) return null;
        if (approval.decisionCommandId === input.clientCommandId
          && approval.decisionKind === input.decision && approval.decisionExpectedVersion === input.expectedVersion) {
          return snapshot(tx, input.projectId, run.id);
        }
        if (approval.status !== "pending" || run.version !== input.expectedVersion || approval.expiresAt <= dependencies.now()
          || approval.toolRevision !== BILLABLE_IMAGE_TOOL_DEFINITION.revision
          || approval.contractHash !== toolDefinitionContractHash(BILLABLE_IMAGE_TOOL_DEFINITION)) return conflict();
        let raw: unknown;
        try { raw = JSON.parse(approval.payloadJson); } catch { return conflict(); }
        const scope = assertScope(raw);
        if (billableImageScopeHash(scope) !== approval.payloadHash || scope.projectId !== input.projectId) return conflict();
        if (input.decision === "approve") {
          const checked = await dependencies.preflight(tx, scope);
          if (checked.targetStateHash !== approval.targetStateHash) return conflict();
        }
        const now = dependencies.now();
        const nextStatus = input.decision === "approve" ? "waiting" : "cancelled";
        const nextActions = input.decision === "approve" ? ["inspect", "dispatch", "cancel"] : ["inspect"];
        const changed = await tx("o_agentToolApproval").where({ id: approval.id, status: "pending" }).update({
          status: input.decision === "approve" ? "approved" : "rejected", decisionKind: input.decision,
          decisionCommandId: input.clientCommandId, decisionExpectedVersion: input.expectedVersion,
          decidedByUserId: input.actorUserId, decidedAt: now,
        });
        const changedRun = await tx("o_agentRun").where({ id: run.id, version: run.version }).update({
          status: nextStatus, waitingReason: input.decision === "approve" ? "vendor-dispatch-authorized" : null,
          attentionReason: null, allowedActions: JSON.stringify(nextActions), version: run.version + 1,
          updatedAt: now, ...(input.decision === "reject" ? { completedAt: now } : {}),
        });
        if (changed !== 1 || changedRun !== 1) return conflict();
        if (input.decision === "reject") {
          await tx("o_agentToolReceipt").where({ id: approval.receiptId, runId: run.id, status: "pending" })
            .update({ status: "cancelled", updatedAt: now });
          await tx("o_agentRunStep").where({ runId: run.id }).update({ status: "cancelled", completedAt: now });
          await tx("o_agentRunAttempt").where({ runId: run.id }).update({ status: "cancelled", completedAt: now });
        }
        const latest = await tx("o_agentTrace").where({ runId: run.id }).max<{ sequence?: number }>("sequence as sequence").first();
        await tx("o_agentTrace").insert({ id: dependencies.createId(), runId: run.id, toolReceiptId: approval.receiptId,
          sequence: Number(latest?.sequence ?? 0) + 1, eventType: `tool.billing-approval.${input.decision}`,
          runStatus: nextStatus, createdAt: now });
        return snapshot(tx, input.projectId, run.id);
        });
      });
    },
  };
}
