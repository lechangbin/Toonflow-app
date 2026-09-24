import { createHash } from "node:crypto";

import type { Knex } from "knex";
import { v4 as uuid } from "uuid";

import {
  AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, AGENT_RUN_OUTPUT_SCHEMA_VERSION,
  canonicalCheckpointPayload, hashCheckpointPayload,
  type AgentRunCheckpointPayload,
} from "@/agentRuntime";
import { appendCausalTrace } from "@/agentRuntime/causalTrace";
import { assertAgentRunLease, type AgentRunLease } from "@/agentRuntime/lease";
import type { DatabaseWork } from "@/database";
import { getDatabaseRuntime } from "@/database";
import { projectTraceSafeDiagnostic } from "@/diagnostics/traceSafeDiagnostics";
import { resolveProductionStoryboardProposalGrants } from "@/skillRuntime/grants";
import { authorizeBoundSkillDefinition } from "@/skillRuntime/permissions";

import { PRODUCTION_STORYBOARD_PROPOSAL_TOOL_DEFINITION,
  STORYBOARD_WRITE_TOOL_DEFINITION, toolDefinitionContractHash } from "./definitions";
import { freezeStoryboardWriteProposal, StoryboardWriteContractError,
  storyboardWriteInput, type StoryboardWriteInput } from "./storyboardWriteContract";
import { insertApprovedStoryboard } from "./storyboardWriteEffect";

export const STORYBOARD_WRITE_RUN_SCOPE = "approved-storyboard-write-v1" as const;
export const STORYBOARD_WRITE_APPROVAL_TTL_MS = 10 * 60_000;
const tool = STORYBOARD_WRITE_TOOL_DEFINITION;
type Status = "pending" | "approved" | "rejected" | "expired" | "conflicted";

export interface StoryboardWriteApprovalSnapshot {
  id: string; runId: string; receiptId: string; operationId: string;
  status: Status; expiresAt: number; runStatus: string; runVersion: number;
  allowedActions: string[];
  payloadHash: string; targetStateHash: string;
  preview: { scriptId: number; trackId: number; duration: number;
    assetCount: number; payloadHash: string };
  payload: StoryboardWriteInput;
  receiptOutput?: { storyboardId: number; assetCount: number };
  sourceRunId?: string; sourceOperationId?: string;
}

export interface StoryboardProposalInput {
  projectId: number; actorUserId: number; clientRequestId: string;
  operationId: string; payload: unknown;
}

export interface StoryboardProposalFromAgentInput {
  projectId: number; parentRunId: string; skillId: string;
  lease: AgentRunLease; operationId: string; payload: unknown;
}

export function storyboardProposalClientRequestId(parentRunId: string,
  operationId: string): string {
  return `storyboard-proposal:${hash(`${parentRunId}:${operationId}`).slice(0, 64)}`;
}

export interface StoryboardDecisionInput {
  projectId: number; actorUserId: number; runId: string; approvalId: string;
  clientCommandId: string; expectedVersion: number; decision: "approve" | "reject";
}

export class StoryboardApprovalConflictError extends Error {
  constructor() { super("Storyboard approval command conflicts with durable state"); }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,128}$/u.test(value);
}

async function assertOwner(db: Knex | Knex.Transaction, projectId: number,
  actorUserId: number): Promise<void> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0
    || !Number.isSafeInteger(actorUserId) || actorUserId <= 0
    || !await db("o_project").where({ id: projectId, userId: actorUserId }).first("id")) {
    throw new StoryboardWriteContractError("scope");
  }
}

function denialDiagnostic(audience: "toolReceipt" | "trace") {
  const projected = projectTraceSafeDiagnostic({
    failureClass: "Tool", stage: "tool-call", kind: "authorizationFailed",
    severity: "error", certainty: "known-no-effect", expectedness: "expected",
    retryDisposition: "never",
  }, audience);
  if (!projected.ok) throw new StoryboardWriteContractError("unsafe");
  return projected.value;
}

async function readSnapshot(db: Knex | Knex.Transaction, projectId: number,
  runId: string): Promise<StoryboardWriteApprovalSnapshot | null> {
  const run = await db("o_agentRun").where({ id: runId, projectId,
    role: "productionAgent", scope: STORYBOARD_WRITE_RUN_SCOPE }).first();
  if (!run) return null;
  const approval = await db("o_agentToolApproval").where({ runId }).first();
  const receipt = approval && await db("o_agentToolReceipt")
    .where({ id: approval.receiptId, runId }).first();
  const catalog = await db("o_agentToolDefinition")
    .where({ name: tool.name, revision: tool.revision }).first("contractHash");
  if (!approval || !receipt || catalog?.contractHash !== toolDefinitionContractHash(tool)
    || approval.contractHash !== catalog.contractHash
    || approval.toolRevision !== tool.revision || receipt.toolRevision !== tool.revision
    || receipt.toolName !== tool.name || receipt.operationId !== approval.operationId
    || receipt.inputHash !== approval.payloadHash
    || approval.payloadHash !== hash(approval.payloadJson)) {
    throw new StoryboardWriteContractError("unsafe");
  }
  let parsed: ReturnType<typeof tool.inputSchema.safeParse>;
  try { parsed = tool.inputSchema.safeParse(JSON.parse(approval.payloadJson)); }
  catch { throw new StoryboardWriteContractError("unsafe"); }
  if (!parsed.success) throw new StoryboardWriteContractError("unsafe");
  const preview = { scriptId: parsed.data.scriptId, trackId: parsed.data.trackId,
    duration: parsed.data.duration, assetCount: parsed.data.associateAssetsIds.length,
    payloadHash: approval.payloadHash };
  if (JSON.stringify(preview) !== approval.previewJson
    || !["pending", "approved", "rejected", "expired", "conflicted"].includes(approval.status)) {
    throw new StoryboardWriteContractError("unsafe");
  }
  let runInput: { operationId?: unknown; payloadHash?: unknown;
    parentRunId?: unknown; parentOperationId?: unknown;
    skillId?: unknown; proposalContractHash?: unknown };
  try { runInput = JSON.parse(run.input); }
  catch { throw new StoryboardWriteContractError("unsafe"); }
  if (runInput.operationId !== approval.operationId
    || runInput.payloadHash !== approval.payloadHash) {
    throw new StoryboardWriteContractError("unsafe");
  }
  const hasSource = runInput.parentRunId !== undefined
    || runInput.parentOperationId !== undefined || runInput.skillId !== undefined
    || runInput.proposalContractHash !== undefined;
  if (hasSource) {
    if (typeof runInput.parentRunId !== "string"
      || typeof runInput.parentOperationId !== "string"
      || typeof runInput.skillId !== "string"
      || runInput.parentOperationId !== approval.operationId
      || runInput.proposalContractHash !== toolDefinitionContractHash(
        PRODUCTION_STORYBOARD_PROPOSAL_TOOL_DEFINITION)) {
      throw new StoryboardWriteContractError("unsafe");
    }
    const parent = await db("o_agentRun").where({ id: runInput.parentRunId,
      projectId, role: "productionAgent", scope: "production-harness-v1" }).first("id");
    const binding = parent && await db("o_agentRunSkillBinding")
      .where({ runId: parent.id, skillId: runInput.skillId }).first("revisionId");
    const permission = binding && await db("o_agentSkillPermissionDecision")
      .where({ runId: parent.id, operationId: runInput.parentOperationId,
        skillId: runInput.skillId,
        toolName: PRODUCTION_STORYBOARD_PROPOSAL_TOOL_DEFINITION.name }).first();
    if (!permission || permission.skillRevisionId !== binding.revisionId
      || hash(permission.decisionJson) !== permission.decisionHash) {
      throw new StoryboardWriteContractError("unsafe");
    }
    try {
      if (JSON.parse(permission.decisionJson).allowed !== true) throw new Error("denied");
    } catch { throw new StoryboardWriteContractError("unsafe"); }
  }
  let receiptOutput: StoryboardWriteApprovalSnapshot["receiptOutput"];
  if (approval.status === "approved") {
    if (receipt.status !== "succeeded" || run.status !== "succeeded"
      || hash(receipt.outputJson) !== receipt.outputHash) {
      throw new StoryboardWriteContractError("unsafe");
    }
    receiptOutput = tool.outputSchema.parse(JSON.parse(receipt.outputJson));
    const row = await db("o_storyboard").where({ id: receiptOutput.storyboardId,
      projectId, scriptId: parsed.data.scriptId, trackId: parsed.data.trackId }).first("id");
    if (!row) throw new StoryboardWriteContractError("unsafe");
  } else if (approval.status === "pending"
    ? receipt.status !== "pending" || run.status !== "waiting"
    : receipt.status !== "failed") {
    throw new StoryboardWriteContractError("unsafe");
  }
  return { id: approval.id, runId, receiptId: receipt.id,
    operationId: approval.operationId, status: approval.status,
    expiresAt: approval.expiresAt, runStatus: run.status, runVersion: run.version,
    allowedActions: JSON.parse(run.allowedActions),
    payloadHash: approval.payloadHash, targetStateHash: approval.targetStateHash,
    preview, payload: parsed.data, ...(receiptOutput ? { receiptOutput } : {}),
    ...(hasSource ? { sourceRunId: runInput.parentRunId as string,
      sourceOperationId: runInput.parentOperationId as string } : {}) };
}

/** Reconnect settles stale pending approvals without replaying a write. */
export async function expireDueStoryboardWriteApprovals(
  db: Knex, projectId: number | null, now: number, createId: () => string,
): Promise<void> {
  const due = db("o_agentToolApproval as approval")
    .join("o_agentRun as run", "run.id", "approval.runId")
    .where({ "approval.status": "pending", "run.role": "productionAgent",
      "run.scope": STORYBOARD_WRITE_RUN_SCOPE, "run.status": "waiting" })
    .where("approval.expiresAt", "<=", now);
  if (projectId !== null) due.where("run.projectId", projectId);
  const rows = await due.select("approval.id");
  for (const row of rows) {
    await db.transaction(async (tx) => {
      const current = await tx("o_agentToolApproval as approval")
        .join("o_agentRun as run", "run.id", "approval.runId")
        .where({ "approval.id": row.id, "approval.status": "pending",
          "run.role": "productionAgent", "run.scope": STORYBOARD_WRITE_RUN_SCOPE,
          "run.status": "waiting" })
        .where("approval.expiresAt", "<=", now)
        .select("approval.id", "approval.receiptId", "approval.runId",
          "run.version", "run.projectId").first();
      if (!current || projectId !== null && current.projectId !== projectId) return;
      const changed = await tx("o_agentToolApproval")
        .where({ id: current.id, status: "pending" })
        .update({ status: "expired", decidedAt: now });
      if (changed !== 1) return;
      const receiptChanged = await tx("o_agentToolReceipt")
        .where({ id: current.receiptId, status: "pending" })
        .update({ status: "failed",
          diagnostic: JSON.stringify(denialDiagnostic("toolReceipt")), updatedAt: now });
      const runChanged = await tx("o_agentRun")
        .where({ id: current.runId, version: current.version, status: "waiting" })
        .update({ waitingReason: "tool-approval-expired",
          attentionReason: "tool-approval-expired",
          allowedActions: JSON.stringify(["inspect"]),
          version: current.version + 1, updatedAt: now });
      if (receiptChanged !== 1 || runChanged !== 1) {
        throw new StoryboardWriteContractError("unsafe");
      }
      await appendCausalTrace(tx, { id: createId(), runId: current.runId,
        toolReceiptId: current.receiptId, eventType: "tool.approval.expired",
        createdAt: now, diagnostic: denialDiagnostic("trace") });
    });
  }
}

/** Owner-local seam. Model proposal and HTTP/UI exposure are separate later slices. */
export function createStoryboardWriteApprovalRuntime(dependencies: {
  work: DatabaseWork; now(): number; createId(): string; approvalTtlMs?: number;
}) {
  const ttl = dependencies.approvalTtlMs ?? STORYBOARD_WRITE_APPROVAL_TTL_MS;
  async function persistProposal(input: StoryboardProposalInput,
    source?: StoryboardProposalFromAgentInput): Promise<StoryboardWriteApprovalSnapshot | null> {
      if (!validId(input.clientRequestId) || !validId(input.operationId) || ttl <= 0) {
        throw new StoryboardWriteContractError("scope");
      }
      const now = dependencies.now();
      return dependencies.work((db) => db.transaction(async (tx) => {
        await assertOwner(tx, input.projectId, input.actorUserId);
        if (source) {
          const parent = await tx("o_agentRun").where({ id: source.parentRunId,
            projectId: input.projectId, role: "productionAgent",
            scope: "production-harness-v1", status: "running" })
            .whereNull("cancellationRequestedAt").first("id", "input");
          if (!parent || source.lease.runId !== parent.id) {
            throw new StoryboardWriteContractError("scope");
          }
          let parentActor: unknown;
          try { parentActor = JSON.parse(parent.input).actorUserId; }
          catch { throw new StoryboardWriteContractError("unsafe"); }
          if (parentActor !== input.actorUserId) throw new StoryboardWriteContractError("scope");
          await assertAgentRunLease(tx, source.lease, now);
          const proposalTool = PRODUCTION_STORYBOARD_PROPOSAL_TOOL_DEFINITION;
          const proposalContractHash = toolDefinitionContractHash(proposalTool);
          const proposalCatalog = await tx("o_agentToolDefinition")
            .where({ name: proposalTool.name, revision: proposalTool.revision })
            .first("contractHash");
          if (proposalCatalog && proposalCatalog.contractHash !== proposalContractHash) {
            throw new StoryboardWriteContractError("unsafe");
          }
          if (!proposalCatalog) await tx("o_agentToolDefinition").insert({
            id: dependencies.createId(), name: proposalTool.name,
            revision: proposalTool.revision, contractHash: proposalContractHash,
            policy: JSON.stringify(proposalTool.policy), createdAt: now,
          });
          const grants = await resolveProductionStoryboardProposalGrants(tx, {
            runId: parent.id, projectId: input.projectId,
          });
          const authority = await authorizeBoundSkillDefinition(tx, {
            runId: parent.id, projectId: input.projectId,
            skillId: source.skillId, ...grants,
          }, proposalTool);
          const decisionJson = JSON.stringify(authority.decision);
          const previous = await tx("o_agentSkillPermissionDecision")
            .where({ runId: parent.id, operationId: source.operationId }).first();
          if (previous) {
            if (previous.skillId !== source.skillId
              || previous.toolName !== proposalTool.name
              || previous.skillRevisionId !== authority.skillRevisionId
              || hash(previous.decisionJson) !== previous.decisionHash) {
              throw new StoryboardWriteContractError("unsafe");
            }
            let allowed: unknown;
            try { allowed = JSON.parse(previous.decisionJson).allowed; }
            catch { throw new StoryboardWriteContractError("unsafe"); }
            if (allowed !== true || !authority.decision.allowed) return null;
          } else {
            await tx("o_agentSkillPermissionDecision").insert({
              id: dependencies.createId(), runId: parent.id, skillId: source.skillId,
              skillRevisionId: authority.skillRevisionId,
              operationId: source.operationId, toolName: proposalTool.name,
              decisionJson, decisionHash: hash(decisionJson), createdAt: now,
            });
            if (!authority.decision.allowed) return null;
          }
        }
        const payload = storyboardWriteInput.parse(input.payload);
        const payloadHash = hash(JSON.stringify(payload));
        const contractHash = toolDefinitionContractHash(tool);
        const requestFingerprint = hash(JSON.stringify({ projectId: input.projectId,
          actorUserId: input.actorUserId, scope: STORYBOARD_WRITE_RUN_SCOPE,
          operationId: input.operationId, toolRevision: tool.revision,
          payloadHash, ...(source ? { parentRunId: source.parentRunId,
            skillId: source.skillId } : {}) }));
        const existing = await tx("o_agentRun").where({ projectId: input.projectId,
          role: "productionAgent", scope: STORYBOARD_WRITE_RUN_SCOPE,
          clientRequestId: input.clientRequestId }).first();
        if (existing) {
          if (existing.requestFingerprint !== requestFingerprint) throw new StoryboardApprovalConflictError();
          const snapshot = await readSnapshot(tx, input.projectId, existing.id);
          if (!snapshot) throw new StoryboardWriteContractError("unsafe");
          return snapshot;
        }
        const frozen = await freezeStoryboardWriteProposal(tx, input.projectId, payload);
        const catalog = await tx("o_agentToolDefinition")
          .where({ name: tool.name, revision: tool.revision }).first();
        if (catalog && catalog.contractHash !== contractHash) throw new StoryboardWriteContractError("unsafe");
        if (!catalog) await tx("o_agentToolDefinition").insert({
          id: dependencies.createId(), name: tool.name, revision: tool.revision,
          contractHash, policy: JSON.stringify(tool.policy), createdAt: now,
        });
        const runId = dependencies.createId();
        const stepId = dependencies.createId();
        const attemptId = dependencies.createId();
        const receiptId = dependencies.createId();
        const approvalId = dependencies.createId();
        await tx("o_agentRun").insert({ id: runId, projectId: input.projectId,
          scriptId: frozen.payload.scriptId, role: "productionAgent",
          scope: STORYBOARD_WRITE_RUN_SCOPE, clientRequestId: input.clientRequestId,
          requestFingerprint, input: JSON.stringify({ operationId: input.operationId,
            payloadHash: frozen.payloadHash,
            ...(source ? { parentRunId: source.parentRunId,
              parentOperationId: source.operationId, skillId: source.skillId,
              proposalContractHash: toolDefinitionContractHash(
                PRODUCTION_STORYBOARD_PROPOSAL_TOOL_DEFINITION) } : {}) }),
          status: "waiting", waitingReason: "tool-approval",
          attentionReason: "tool-approval-required",
          allowedActions: JSON.stringify(["inspect", "approve", "reject"]),
          version: 1, createdAt: now, updatedAt: now, startedAt: now, fence: 0,
        });
        await tx("o_agentRunStep").insert({ id: stepId, runId, ordinal: 1,
          kind: "tool", logicalTarget: JSON.stringify({ kind: "tool", name: tool.name }),
          promptFingerprint: requestFingerprint, status: "waiting", startedAt: now });
        await tx("o_agentRunAttempt").insert({ id: attemptId, runId, stepId,
          ordinal: 1, reason: "initial", status: "waiting", createdAt: now, startedAt: now });
        await tx("o_agentToolReceipt").insert({ id: receiptId, runId,
          operationId: input.operationId, toolName: tool.name,
          toolRevision: tool.revision, inputHash: frozen.payloadHash,
          status: "pending", createdAt: now, updatedAt: now });
        await tx("o_agentToolApproval").insert({ id: approvalId, runId,
          receiptId, operationId: input.operationId, toolRevision: tool.revision,
          contractHash, payloadJson: frozen.payloadJson, payloadHash: frozen.payloadHash,
          targetStateHash: frozen.targetStateHash,
          previewJson: JSON.stringify(frozen.preview), status: "pending",
          expiresAt: now + ttl, createdAt: now });
        const checkpoint: AgentRunCheckpointPayload = {
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, kind: "run-created",
          runId, stepId, attemptId, sequence: 1, runVersion: 1,
          lastCommittedStepId: null, predecessorCheckpointId: null,
          predecessorPayloadHash: null, requestFingerprint,
        };
        await tx("o_agentRunCheckpoint").insert({ id: dependencies.createId(),
          runId, stepId, attemptId, sequence: 1, kind: "run-created",
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, runVersion: 1,
          lastCommittedStepId: null, predecessorCheckpointId: null,
          payload: canonicalCheckpointPayload(checkpoint),
          payloadHash: hashCheckpointPayload(checkpoint), createdAt: now });
        await appendCausalTrace(tx, { id: dependencies.createId(), runId,
          stepId, attemptId, toolReceiptId: receiptId,
          eventType: "tool.approval.requested", createdAt: now });
        if (source) await appendCausalTrace(tx, { id: dependencies.createId(),
          runId: source.parentRunId, eventType: "tool.proposal.created", createdAt: now });
        const snapshot = await readSnapshot(tx, input.projectId, runId);
        if (!snapshot) throw new StoryboardWriteContractError("unsafe");
        return snapshot;
      }));
  }
  return {
    async propose(input: StoryboardProposalInput): Promise<StoryboardWriteApprovalSnapshot> {
      const result = await persistProposal(input);
      if (!result) throw new StoryboardWriteContractError("unsafe");
      return result;
    },

    async proposeFromAgent(source: StoryboardProposalFromAgentInput): Promise<
      { status: "denied" } | { status: "pending"; approvalRunId: string; approvalId: string }> {
      const actorUserId = await dependencies.work(async (db) => {
        const project = await db("o_project").where({ id: source.projectId }).first("userId");
        return Number(project?.userId);
      });
      const result = await persistProposal({ projectId: source.projectId, actorUserId,
        clientRequestId: storyboardProposalClientRequestId(source.parentRunId,
          source.operationId), operationId: source.operationId,
        payload: source.payload }, source);
      return result ? { status: "pending", approvalRunId: result.runId,
        approvalId: result.id } : { status: "denied" };
    },

    async inspect(projectId: number, runId: string, actorUserId: number) {
      return dependencies.work(async (db) => {
        await assertOwner(db, projectId, actorUserId);
        await expireDueStoryboardWriteApprovals(db, projectId,
          dependencies.now(), dependencies.createId);
        return readSnapshot(db, projectId, runId);
      });
    },

    async decide(input: StoryboardDecisionInput): Promise<StoryboardWriteApprovalSnapshot | null> {
      if (!validId(input.clientCommandId) || !Number.isSafeInteger(input.expectedVersion)
        || input.expectedVersion <= 0 || !["approve", "reject"].includes(input.decision)) {
        throw new StoryboardWriteContractError("scope");
      }
      const now = dependencies.now();
      return dependencies.work((db) => db.transaction(async (tx) => {
        await assertOwner(tx, input.projectId, input.actorUserId);
        const run = await tx("o_agentRun").where({ id: input.runId,
          projectId: input.projectId, role: "productionAgent",
          scope: STORYBOARD_WRITE_RUN_SCOPE }).first();
        if (!run) return null;
        const approval = await tx("o_agentToolApproval")
          .where({ id: input.approvalId, runId: run.id }).first();
        if (!approval) return null;
        if (approval.decisionCommandId === input.clientCommandId) {
          if (approval.decisionExpectedVersion !== input.expectedVersion
            || approval.decisionKind !== input.decision) throw new StoryboardApprovalConflictError();
          return readSnapshot(tx, input.projectId, run.id);
        }
        if (approval.decisionCommandId || run.version !== input.expectedVersion
          || run.status !== "waiting" || approval.status !== "pending"
          || run.cancellationRequestedAt != null) throw new StoryboardApprovalConflictError();
        const snapshot = await readSnapshot(tx, input.projectId, run.id);
        if (!snapshot) throw new StoryboardWriteContractError("unsafe");
        const receipt = await tx("o_agentToolReceipt")
          .where({ id: approval.receiptId, runId: run.id, status: "pending" }).first();
        if (!receipt) throw new StoryboardWriteContractError("unsafe");
        let failure: "rejected" | "expired" | "conflicted" | null =
          now >= approval.expiresAt ? "expired"
            : input.decision === "reject" ? "rejected" : null;
        if (!failure) {
          try {
            const current = await freezeStoryboardWriteProposal(tx, input.projectId, snapshot.payload);
            if (current.targetStateHash !== approval.targetStateHash) failure = "conflicted";
          } catch (error) {
            if (error instanceof StoryboardWriteContractError) failure = "conflicted";
            else throw error;
          }
        }
        if (failure) {
          await tx("o_agentToolApproval").where("id", approval.id).update({
            status: failure, decisionKind: input.decision,
            decisionCommandId: input.clientCommandId,
            decisionExpectedVersion: input.expectedVersion,
            decidedByUserId: input.actorUserId, decidedAt: now,
          });
          await tx("o_agentToolReceipt").where("id", receipt.id).update({
            status: "failed", diagnostic: JSON.stringify(denialDiagnostic("toolReceipt")),
            updatedAt: now,
          });
          const rejected = failure === "rejected";
          await tx("o_agentRun").where("id", run.id).update({
            status: rejected ? "cancelled" : "waiting",
            waitingReason: rejected ? null : `tool-approval-${failure}`,
            attentionReason: rejected ? null : `tool-approval-${failure}`,
            allowedActions: JSON.stringify(["inspect"]), version: run.version + 1,
            updatedAt: now, ...(rejected ? { completedAt: now } : {}),
          });
          if (rejected) {
            await tx("o_agentRunStep").where({ runId: run.id })
              .update({ status: "cancelled", completedAt: now });
            await tx("o_agentRunAttempt").where({ runId: run.id })
              .update({ status: "cancelled", completedAt: now });
          }
          await appendCausalTrace(tx, { id: dependencies.createId(), runId: run.id,
            toolReceiptId: receipt.id, eventType: `tool.approval.${failure}`,
            createdAt: now, ...(rejected ? {} : { diagnostic: denialDiagnostic("trace") }) });
          return readSnapshot(tx, input.projectId, run.id);
        }
        const result = tool.outputSchema.parse(await insertApprovedStoryboard(tx, {
          projectId: input.projectId, payload: snapshot.payload,
          payloadHash: approval.payloadHash, targetStateHash: approval.targetStateHash,
          now,
        }));
        const outputJson = JSON.stringify(result);
        const step = await tx("o_agentRunStep").where({ runId: run.id }).first();
        const attempt = await tx("o_agentRunAttempt").where({ runId: run.id }).first();
        const predecessor = await tx("o_agentRunCheckpoint")
          .where({ runId: run.id }).orderBy("sequence", "desc").first();
        if (!step || !attempt || !predecessor || predecessor.kind !== "run-created") {
          throw new StoryboardWriteContractError("unsafe");
        }
        const outputId = dependencies.createId();
        const outputContent = `${tool.name} committed`;
        const outputContentHash = hash(JSON.stringify(outputContent));
        await tx("o_agentToolApproval").where("id", approval.id).update({
          status: "approved", decisionKind: input.decision,
          decisionCommandId: input.clientCommandId,
          decisionExpectedVersion: input.expectedVersion,
          decidedByUserId: input.actorUserId, decidedAt: now,
        });
        await tx("o_agentToolReceipt").where("id", receipt.id).update({
          status: "succeeded", outputJson, outputHash: hash(outputJson), updatedAt: now,
        });
        await tx("o_agentRunOutput").insert({ id: outputId, runId: run.id,
          stepId: step.id, kind: "assistant-text", content: outputContent,
          contentHash: outputContentHash,
          schemaVersion: AGENT_RUN_OUTPUT_SCHEMA_VERSION, createdAt: now });
        await tx("o_agentRunStep").where("id", step.id)
          .update({ status: "succeeded", completedAt: now });
        await tx("o_agentRunAttempt").where("id", attempt.id)
          .update({ status: "succeeded", completedAt: now });
        await tx("o_agentRun").where("id", run.id).update({
          status: "succeeded", waitingReason: null, attentionReason: null,
          allowedActions: JSON.stringify(["inspect"]), version: run.version + 1,
          lastCommittedStepId: step.id, updatedAt: now, completedAt: now,
        });
        const checkpoint: AgentRunCheckpointPayload = {
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
          kind: "step-committed", runId: run.id, stepId: step.id,
          attemptId: attempt.id, sequence: predecessor.sequence + 1,
          runVersion: run.version + 1, lastCommittedStepId: step.id,
          predecessorCheckpointId: predecessor.id,
          predecessorPayloadHash: predecessor.payloadHash,
          outputId, outputContentHash,
        };
        await tx("o_agentRunCheckpoint").insert({ id: dependencies.createId(),
          runId: run.id, stepId: step.id, attemptId: attempt.id,
          sequence: checkpoint.sequence, kind: "step-committed",
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
          runVersion: checkpoint.runVersion, lastCommittedStepId: step.id,
          predecessorCheckpointId: predecessor.id,
          payload: canonicalCheckpointPayload(checkpoint),
          payloadHash: hashCheckpointPayload(checkpoint), createdAt: now });
        await appendCausalTrace(tx, { id: dependencies.createId(), runId: run.id,
          stepId: step.id, attemptId: attempt.id, toolReceiptId: receipt.id,
          eventType: "tool.approval.committed", createdAt: now });
        return readSnapshot(tx, input.projectId, run.id);
      }));
    },
  };
}

export function getDefaultStoryboardWriteApprovalRuntime() {
  return createStoryboardWriteApprovalRuntime({
    work: (operation) => getDatabaseRuntime().work(operation), now: Date.now,
    createId: uuid,
  });
}
