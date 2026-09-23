import { createHash } from "node:crypto";

import type { Knex } from "knex";
import { v4 as uuid } from "uuid";
import { z } from "zod";

import { canonicalAssetBriefType } from "@/assets/assetBriefContract";
import {
  areDimensionsCompatibleWithBriefType,
  findEquivalentDerivedAsset,
  saveDerivedChangeInstruction,
} from "@/assets/derivedChangeInstruction";
import type { DatabaseWork } from "@/database";
import { getDatabaseRuntime } from "@/database";
import {
  inspectPersistableText,
  projectTraceSafeDiagnostic,
  type TraceSafeDiagnostic,
} from "@/diagnostics/traceSafeDiagnostics";
import {
  AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
  AGENT_RUN_OUTPUT_SCHEMA_VERSION,
  canonicalCheckpointPayload,
  hashCheckpointPayload,
  type AgentRunCheckpointPayload,
} from "@/agentRuntime";
import { appendCausalTrace } from "@/agentRuntime/causalTrace";

import { DERIVED_ASSET_TOOL_DEFINITION, toolDefinitionContractHash } from "./definitions";

export const DERIVED_ASSET_RUN_SCOPE = "approved-derived-asset-write-v1" as const;
export const DERIVED_ASSET_RUN_ROLE = "productionAgent" as const;
export const DERIVED_ASSET_APPROVAL_TTL_MS = 10 * 60_000;

const tool = DERIVED_ASSET_TOOL_DEFINITION;
type Payload = z.infer<typeof tool.inputSchema>;
type Decision = "approve" | "reject";
type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "conflicted" | "corrupt";

export interface ProposeDerivedAssetInput {
  projectId: number;
  actorUserId: number;
  clientRequestId: string;
  operationId: string;
  payload: unknown;
}

export interface DecideDerivedAssetInput {
  projectId: number;
  runId: string;
  approvalId: string;
  clientCommandId: string;
  expectedVersion: number;
  actorUserId: number;
  decision: Decision;
}

export interface DerivedAssetApprovalSnapshot {
  id: string;
  runId: string;
  receiptId: string;
  operationId: string;
  toolName: typeof tool.name;
  toolRevision: typeof tool.revision;
  payloadHash: string;
  contractHash: string;
  status: ApprovalStatus;
  expiresAt: number;
  preview: { effect: "create" | "update"; parentAssetId: number; assetId: number | null; expectedVersion: number; name: string; dimensions: string[] };
  runStatus: string;
  runVersion: number;
  allowedActions: string[];
  receiptStatus: string;
  receiptOutput?: { assetId: number; revision: number; effect: "created" | "updated" };
  attentionReason?: string;
}

export interface DerivedAssetWriteDependencies {
  work: DatabaseWork;
  now(): number;
  createId(): string;
  approvalTtlMs?: number;
}

export class DerivedAssetWriteRejectedError extends Error {
  constructor(readonly reason: "contract" | "scope" | "version" | "equivalent" | "unsafe") {
    super(`Derived Asset write proposal rejected: ${reason}`);
    this.name = "DerivedAssetWriteRejectedError";
  }
}

export class DerivedAssetCommandConflictError extends Error {
  constructor() {
    super("Derived Asset approval command conflicts with durable state");
    this.name = "DerivedAssetCommandConflictError";
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function previewFor(payload: Payload): DerivedAssetApprovalSnapshot["preview"] {
  return {
    effect: payload.assetId === null ? "create" : "update", parentAssetId: payload.parentAssetId,
    assetId: payload.assetId, expectedVersion: payload.expectedVersion, name: payload.name,
    dimensions: payload.changeInstruction.dimensions,
  };
}

function safeDiagnostic(kind: "authorizationFailed" | "executionFailed" | "invalidOutput"): TraceSafeDiagnostic {
  const result = projectTraceSafeDiagnostic({
    failureClass: "Tool", stage: "tool-call", kind, severity: "error",
    certainty: "known-no-effect", expectedness: "expected", retryDisposition: "never",
  }, "toolReceipt");
  if (!result.ok) throw new Error("Tool diagnostic projection failed");
  return result.value;
}

function stateHash(parent: any, asset: any | null, instruction: any | null): string {
  return hash(JSON.stringify({
    parent: { id: parent.id, projectId: parent.projectId, type: parent.type, assetsId: parent.assetsId },
    asset: asset ? {
      id: asset.id, projectId: asset.projectId, assetsId: asset.assetsId, type: asset.type,
      scriptId: asset.scriptId, name: asset.name, describe: asset.describe,
    } : null,
    instruction: instruction ? {
      id: instruction.id, projectId: instruction.projectId, assetsId: instruction.assetsId,
      revision: instruction.revision, source: instruction.source, instruction: instruction.instruction,
    } : null,
  }));
}

async function targetState(
  db: Knex | Knex.Transaction, projectId: number, payload: Payload,
): Promise<{ parent: any; asset: any | null; instruction: any | null; stateHash: string }> {
  const [parent, script] = await Promise.all([
    db("o_assets").where({ id: payload.parentAssetId, projectId }).first(),
    db("o_script").where({ id: payload.scriptId, projectId }).first("id"),
  ]);
  if (!parent || parent.assetsId != null || !script) throw new DerivedAssetWriteRejectedError("scope");
  const briefType = canonicalAssetBriefType(parent.type);
  if (!briefType || !areDimensionsCompatibleWithBriefType(payload.changeInstruction.dimensions, briefType)
    || payload.changeInstruction.evidence.length === 0) throw new DerivedAssetWriteRejectedError("contract");
  let asset: any | null = null;
  let instruction: any | null = null;
  if (payload.assetId !== null) {
    asset = await db("o_assets").where({
      id: payload.assetId, projectId, assetsId: parent.id, type: parent.type,
    }).first();
    if (!asset || asset.scriptId !== payload.scriptId) throw new DerivedAssetWriteRejectedError("scope");
    instruction = await db("o_derivedChangeInstruction").where({ assetsId: asset.id, projectId }).first();
    if (!instruction || !Number.isSafeInteger(instruction.revision) || instruction.revision <= 0) {
      throw new DerivedAssetWriteRejectedError("version");
    }
    if (instruction.revision !== payload.expectedVersion) throw new DerivedAssetWriteRejectedError("version");
  } else if (payload.expectedVersion !== 0) {
    throw new DerivedAssetWriteRejectedError("version");
  }
  return { parent, asset, instruction, stateHash: stateHash(parent, asset, instruction) };
}

async function assertProjectOwner(db: Knex | Knex.Transaction, projectId: number, actorUserId: number): Promise<void> {
  if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) throw new DerivedAssetWriteRejectedError("scope");
  const project = await db("o_project").where({ id: projectId, userId: actorUserId }).first("id");
  if (!project) throw new DerivedAssetWriteRejectedError("scope");
}

async function assertNoEquivalent(db: Knex.Transaction, projectId: number, payload: Payload): Promise<void> {
  const existing = await findEquivalentDerivedAsset(async (operation) => operation(db), {
    projectId, parentAssetsId: payload.parentAssetId,
    dimensions: payload.changeInstruction.dimensions, change: payload.changeInstruction.change,
    ...(payload.assetId !== null ? { excludeAssetsId: payload.assetId } : {}),
  });
  if (existing !== null) throw new DerivedAssetWriteRejectedError("equivalent");
}

async function addTrace(db: Knex.Transaction, runId: string, receiptId: string, eventType: string, now: number, createId: () => string): Promise<void> {
  await appendCausalTrace(db, {
    id: createId(), runId, toolReceiptId: receiptId, eventType, createdAt: now,
  });
}

/** Expiry is a durable local transition, independent of a browser click. */
export async function expireDueDerivedAssetApprovals(
  db: Knex, projectId: number | null, now: number, createId: () => string,
): Promise<void> {
  const due = db("o_agentToolApproval as approval")
    .join("o_agentRun as run", "run.id", "approval.runId")
    .where({ "approval.status": "pending", "run.role": DERIVED_ASSET_RUN_ROLE,
      "run.scope": DERIVED_ASSET_RUN_SCOPE, "run.status": "waiting" })
    .where("approval.expiresAt", "<=", now);
  if (projectId !== null) due.where("run.projectId", projectId);
  const rows = await due.select("approval.id");
  for (const row of rows) {
    await db.transaction(async (tx) => {
      const current = await tx("o_agentToolApproval as approval")
        .join("o_agentRun as run", "run.id", "approval.runId")
        .where({ "approval.id": row.id, "approval.status": "pending",
          "run.role": DERIVED_ASSET_RUN_ROLE, "run.scope": DERIVED_ASSET_RUN_SCOPE,
          "run.status": "waiting" })
        .where("approval.expiresAt", "<=", now)
        .select("approval.id", "approval.receiptId", "approval.runId", "run.version", "run.projectId")
        .first();
      if (!current || (projectId !== null && current.projectId !== projectId)) return;
      const changed = await tx("o_agentToolApproval").where({ id: current.id, status: "pending" })
        .update({ status: "expired", decidedAt: now });
      if (changed !== 1) return;
      const receiptChanged = await tx("o_agentToolReceipt").where({ id: current.receiptId, status: "pending" }).update({
        status: "failed", diagnostic: JSON.stringify(safeDiagnostic("authorizationFailed")), updatedAt: now,
      });
      const runChanged = await tx("o_agentRun").where({ id: current.runId, version: current.version,
        status: "waiting" }).update({
        status: "waiting", waitingReason: "tool-approval-expired", attentionReason: "tool-approval-expired",
        allowedActions: JSON.stringify(["inspect"]), version: current.version + 1, updatedAt: now,
      });
      if (receiptChanged !== 1 || runChanged !== 1) throw new DerivedAssetWriteRejectedError("unsafe");
      await addTrace(tx, current.runId, current.receiptId, "tool.approval.expired", now, createId);
    });
  }
}

async function readSnapshot(db: Knex | Knex.Transaction, projectId: number, runId: string): Promise<DerivedAssetApprovalSnapshot | null> {
  const run = await db("o_agentRun").where({ id: runId, projectId, role: DERIVED_ASSET_RUN_ROLE, scope: DERIVED_ASSET_RUN_SCOPE }).first();
  if (!run) return null;
  const approval = await db("o_agentToolApproval").where({ runId }).first();
  const receipt = approval && await db("o_agentToolReceipt").where({ id: approval.receiptId, runId }).first();
  const catalog = await db("o_agentToolDefinition").where({ name: tool.name, revision: tool.revision }).first();
  if (!approval || !receipt) throw new DerivedAssetWriteRejectedError("unsafe");
  let preview: DerivedAssetApprovalSnapshot["preview"];
  let evidenceCorrupt = !(["pending", "approved", "rejected", "expired", "conflicted", "corrupt"] as string[]).includes(approval.status)
    || (approval.status === "pending" && receipt.status !== "pending")
    || (approval.status === "approved" && receipt.status !== "succeeded")
    || (!["pending", "approved"].includes(approval.status) && receipt.status !== "failed");
  try {
    const parsed = tool.inputSchema.parse(JSON.parse(approval.payloadJson));
    preview = previewFor(parsed);
    if (hash(approval.payloadJson) !== approval.payloadHash
      || JSON.stringify(preview) !== approval.previewJson
      || approval.toolRevision !== tool.revision
      || approval.contractHash !== toolDefinitionContractHash(tool)
      || catalog?.contractHash !== approval.contractHash
      || receipt.inputHash !== approval.payloadHash
      || receipt.operationId !== approval.operationId
      || !inspectPersistableText(approval.payloadJson).ok) throw new Error("invalid approval evidence");
  } catch {
    evidenceCorrupt = true;
    preview = { effect: "update", parentAssetId: 0, assetId: null, expectedVersion: 0,
      name: "审批证据不可用", dimensions: [] };
  }
  let receiptOutput: DerivedAssetApprovalSnapshot["receiptOutput"];
  if (receipt.status === "succeeded") {
    try {
      if (hash(receipt.outputJson) !== receipt.outputHash) throw new Error("invalid receipt hash");
      receiptOutput = tool.outputSchema.parse(JSON.parse(receipt.outputJson));
    } catch { evidenceCorrupt = true; }
  }
  return {
    id: approval.id, runId, receiptId: receipt.id, operationId: approval.operationId,
    toolName: tool.name, toolRevision: approval.toolRevision, payloadHash: approval.payloadHash,
    contractHash: approval.contractHash, status: evidenceCorrupt ? "corrupt" : approval.status, expiresAt: approval.expiresAt,
    preview, runStatus: run.status, runVersion: run.version,
    allowedActions: evidenceCorrupt ? ["inspect"] : JSON.parse(run.allowedActions), receiptStatus: receipt.status,
    ...(receiptOutput ? { receiptOutput } : {}),
    ...(run.attentionReason ? { attentionReason: run.attentionReason } : {}),
  };
}

/** User-supervised local write seam. The proposal is durable before any approval action. */
export function createDerivedAssetWriteRuntime(dependencies: DerivedAssetWriteDependencies) {
  const ttl = dependencies.approvalTtlMs ?? DERIVED_ASSET_APPROVAL_TTL_MS;
  return {
    async propose(input: ProposeDerivedAssetInput): Promise<DerivedAssetApprovalSnapshot> {
      const parsed = tool.inputSchema.safeParse(input.payload);
      if (!parsed.success || !Number.isSafeInteger(input.projectId) || input.projectId <= 0
        || !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.clientRequestId)
        || !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.operationId) || ttl <= 0) {
        throw new DerivedAssetWriteRejectedError("contract");
      }
      const payload = parsed.data;
      const payloadJson = JSON.stringify(payload);
      if (!inspectPersistableText(payloadJson).ok) throw new DerivedAssetWriteRejectedError("unsafe");
      const payloadHash = hash(payloadJson);
      const contractHash = toolDefinitionContractHash(tool);
      const requestFingerprint = hash(JSON.stringify({ projectId: input.projectId, actorUserId: input.actorUserId, role: DERIVED_ASSET_RUN_ROLE,
        scope: DERIVED_ASSET_RUN_SCOPE, operationId: input.operationId, toolRevision: tool.revision, payloadHash }));
      const now = dependencies.now();
      return dependencies.work((db) => db.transaction(async (tx) => {
        await assertProjectOwner(tx, input.projectId, input.actorUserId);
        const existing = await tx("o_agentRun").where({ projectId: input.projectId, role: DERIVED_ASSET_RUN_ROLE,
          scope: DERIVED_ASSET_RUN_SCOPE, clientRequestId: input.clientRequestId }).first();
        if (existing) {
          if (existing.requestFingerprint !== requestFingerprint) throw new DerivedAssetCommandConflictError();
          const snapshot = await readSnapshot(tx, input.projectId, existing.id);
          if (!snapshot) throw new DerivedAssetWriteRejectedError("unsafe");
          return snapshot;
        }
        const target = await targetState(tx, input.projectId, payload);
        await assertNoEquivalent(tx, input.projectId, payload);
        const catalog = await tx("o_agentToolDefinition").where({ name: tool.name, revision: tool.revision }).first();
        if (catalog && catalog.contractHash !== contractHash) throw new DerivedAssetWriteRejectedError("unsafe");
        if (!catalog) await tx("o_agentToolDefinition").insert({
          id: dependencies.createId(), name: tool.name, revision: tool.revision,
          contractHash, policy: JSON.stringify(tool.policy), createdAt: now,
        });
        const runId = dependencies.createId();
        const stepId = dependencies.createId();
        const attemptId = dependencies.createId();
        const receiptId = dependencies.createId();
        const approvalId = dependencies.createId();
        const preview = previewFor(payload);
        await tx("o_agentRun").insert({
          id: runId, projectId: input.projectId, scriptId: payload.scriptId, role: DERIVED_ASSET_RUN_ROLE,
          scope: DERIVED_ASSET_RUN_SCOPE, clientRequestId: input.clientRequestId,
          requestFingerprint, input: JSON.stringify({ operationId: input.operationId, payloadHash }),
          status: "waiting", waitingReason: "tool-approval", attentionReason: "tool-approval-required",
          allowedActions: JSON.stringify(["inspect", "approve", "reject"]), version: 1,
          createdAt: now, updatedAt: now, startedAt: now, fence: 0,
        });
        await tx("o_agentRunStep").insert({
          id: stepId, runId, ordinal: 1, kind: "tool", logicalTarget: JSON.stringify({ kind: "tool", name: tool.name }),
          promptFingerprint: requestFingerprint, status: "waiting", startedAt: now,
        });
        await tx("o_agentRunAttempt").insert({
          id: attemptId, runId, stepId, ordinal: 1, reason: "initial", status: "waiting", createdAt: now, startedAt: now,
        });
        await tx("o_agentToolReceipt").insert({
          id: receiptId, runId, operationId: input.operationId, toolName: tool.name, toolRevision: tool.revision,
          inputHash: payloadHash, status: "pending", createdAt: now, updatedAt: now,
        });
        await tx("o_agentToolApproval").insert({
          id: approvalId, runId, receiptId, operationId: input.operationId, toolRevision: tool.revision,
          contractHash, payloadJson, payloadHash, targetStateHash: target.stateHash,
          previewJson: JSON.stringify(preview), status: "pending", expiresAt: now + ttl, createdAt: now,
        });
        const checkpointPayload: AgentRunCheckpointPayload = {
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, kind: "run-created", runId, stepId, attemptId,
          sequence: 1, runVersion: 1, lastCommittedStepId: null,
          predecessorCheckpointId: null, predecessorPayloadHash: null, requestFingerprint,
        };
        await tx("o_agentRunCheckpoint").insert({
          id: dependencies.createId(), runId, stepId, attemptId, sequence: 1, kind: "run-created",
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, runVersion: 1,
          lastCommittedStepId: null, predecessorCheckpointId: null,
          payload: canonicalCheckpointPayload(checkpointPayload), payloadHash: hashCheckpointPayload(checkpointPayload), createdAt: now,
        });
        await addTrace(tx, runId, receiptId, "tool.approval.requested", now, dependencies.createId);
        const snapshot = await readSnapshot(tx, input.projectId, runId);
        if (!snapshot) throw new DerivedAssetWriteRejectedError("unsafe");
        return snapshot;
      }));
    },

    async inspect(projectId: number, runId: string, actorUserId: number): Promise<DerivedAssetApprovalSnapshot | null> {
      return dependencies.work(async (db) => {
        await assertProjectOwner(db, projectId, actorUserId);
        await expireDueDerivedAssetApprovals(db, projectId, dependencies.now(), dependencies.createId);
        return readSnapshot(db, projectId, runId);
      });
    },

    async list(projectId: number, actorUserId: number): Promise<DerivedAssetApprovalSnapshot[]> {
      return dependencies.work(async (db) => {
        await assertProjectOwner(db, projectId, actorUserId);
        await expireDueDerivedAssetApprovals(db, projectId, dependencies.now(), dependencies.createId);
        const rows = await db("o_agentRun as run")
          .join("o_agentToolApproval as approval", "approval.runId", "run.id")
          .where({ "run.projectId": projectId, "run.role": DERIVED_ASSET_RUN_ROLE,
            "run.scope": DERIVED_ASSET_RUN_SCOPE })
          .orderByRaw("CASE WHEN approval.status = 'pending' THEN 0 ELSE 1 END")
          .orderBy("run.createdAt", "desc").orderBy("run.id", "desc")
          .limit(20).select("run.id");
        const snapshots = await Promise.all(rows.map((row) => readSnapshot(db, projectId, row.id)));
        return snapshots.filter((snapshot): snapshot is DerivedAssetApprovalSnapshot => snapshot !== null);
      });
    },

    async decide(input: DecideDerivedAssetInput): Promise<DerivedAssetApprovalSnapshot | null> {
      if (!Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0
        || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion <= 0
        || !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.clientCommandId)) throw new DerivedAssetWriteRejectedError("contract");
      const now = dependencies.now();
      return dependencies.work((db) => db.transaction(async (tx) => {
        await assertProjectOwner(tx, input.projectId, input.actorUserId);
        const run = await tx("o_agentRun").where({ id: input.runId, projectId: input.projectId,
          role: DERIVED_ASSET_RUN_ROLE, scope: DERIVED_ASSET_RUN_SCOPE }).first();
        if (!run) return null;
        const approval = await tx("o_agentToolApproval").where({ id: input.approvalId, runId: run.id }).first();
        if (!approval) return null;
        if (approval.decisionCommandId === input.clientCommandId) {
          if (approval.decisionExpectedVersion !== input.expectedVersion
            || approval.decisionKind !== input.decision) {
            throw new DerivedAssetCommandConflictError();
          }
          return readSnapshot(tx, input.projectId, run.id);
        }
        if (approval.decisionCommandId || run.version !== input.expectedVersion || approval.status !== "pending"
          || run.status !== "waiting" || run.cancellationRequestedAt != null) {
          throw new DerivedAssetCommandConflictError();
        }
        const receipt = await tx("o_agentToolReceipt").where({ id: approval.receiptId, runId: run.id, status: "pending" }).first();
        if (!receipt) throw new DerivedAssetWriteRejectedError("unsafe");
        const catalog = await tx("o_agentToolDefinition").where({ name: tool.name, revision: tool.revision }).first();
        const evidenceValid = catalog?.contractHash === toolDefinitionContractHash(tool)
          && approval.contractHash === catalog?.contractHash
          && approval.toolRevision === tool.revision
          && hash(approval.payloadJson) === approval.payloadHash
          && receipt.inputHash === approval.payloadHash
          && receipt.operationId === approval.operationId;
        let parsed: ReturnType<typeof tool.inputSchema.safeParse> | null = null;
        try { if (evidenceValid) parsed = tool.inputSchema.safeParse(JSON.parse(approval.payloadJson)); }
        catch { parsed = null; }
        let failure: ApprovalStatus | null = !evidenceValid || !parsed?.success ? "corrupt" : null;
        if (!failure && parsed?.success && JSON.stringify(previewFor(parsed.data)) !== approval.previewJson) failure = "corrupt";
        if (!failure && now >= approval.expiresAt) failure = "expired";
        if (!failure && input.decision === "reject") failure = "rejected";
        let output: z.infer<typeof tool.outputSchema> | undefined;
        let target: Awaited<ReturnType<typeof targetState>> | undefined;
        if (!failure && parsed?.success) {
          try {
            target = await targetState(tx, input.projectId, parsed.data);
            if (target.stateHash !== approval.targetStateHash) throw new DerivedAssetWriteRejectedError("version");
            await assertNoEquivalent(tx, input.projectId, parsed.data);
          } catch (error) {
            if (error instanceof DerivedAssetWriteRejectedError) failure = error.reason === "unsafe" ? "corrupt" : "conflicted";
            else throw error;
          }
        }
        if (!failure && parsed?.success && target) {
            const payload = parsed.data;
            let assetId = payload.assetId;
            if (assetId === null) {
              const [id] = await tx("o_assets").insert({
                projectId: input.projectId, assetsId: payload.parentAssetId, type: target.parent.type,
                scriptId: payload.scriptId, name: payload.name, describe: payload.description, startTime: now,
              });
              assetId = id;
              await tx("o_scriptAssets").insert({ scriptId: payload.scriptId, assetId });
            } else {
              const changed = await tx("o_assets").where({
                id: assetId, projectId: input.projectId, assetsId: payload.parentAssetId,
                type: target.parent.type,
              }).update({ name: payload.name, describe: payload.description });
              if (changed !== 1) throw new DerivedAssetWriteRejectedError("version");
            }
            const saved = await saveDerivedChangeInstruction(async (operation) => operation(tx), {
              projectId: input.projectId, assetsId: assetId!, instruction: payload.changeInstruction,
              source: "agent", expectedBriefType: canonicalAssetBriefType(target.parent.type)!, now: () => now,
            });
            if (!saved.ok) throw new DerivedAssetWriteRejectedError("contract");
            output = { assetId: assetId!, revision: saved.value.revision,
              effect: payload.assetId === null ? "created" : "updated" };
        }
        // A failed authorization never leaves a partial production write. The entire
        // mutation and its receipt live in this one transaction.
        if (failure) {
          await tx("o_agentToolApproval").where("id", approval.id).update({
            status: failure, decisionKind: input.decision, decisionCommandId: input.clientCommandId,
            decisionExpectedVersion: input.expectedVersion,
            decidedByUserId: input.actorUserId, decidedAt: now,
          });
          await tx("o_agentToolReceipt").where("id", receipt.id).update({
            status: "failed", diagnostic: JSON.stringify(safeDiagnostic("authorizationFailed")), updatedAt: now,
          });
          await tx("o_agentRun").where("id", run.id).update({
            status: failure === "rejected" ? "cancelled" : "waiting",
            waitingReason: failure === "rejected" ? null : "tool-approval-conflict",
            attentionReason: failure === "rejected" ? null : `tool-approval-${failure}`,
            allowedActions: JSON.stringify(["inspect"]), version: run.version + 1, updatedAt: now,
            ...(failure === "rejected" ? { completedAt: now } : {}),
          });
          await tx("o_agentRunStep").where({ runId: run.id }).update({ status: failure === "rejected" ? "cancelled" : "waiting",
            ...(failure === "rejected" ? { completedAt: now } : {}) });
          await tx("o_agentRunAttempt").where({ runId: run.id }).update({ status: failure === "rejected" ? "cancelled" : "waiting",
            ...(failure === "rejected" ? { completedAt: now } : {}) });
          await addTrace(tx, run.id, receipt.id, `tool.approval.${failure}`, now, dependencies.createId);
        } else {
          const result = tool.outputSchema.parse(output);
          const outputJson = JSON.stringify(result);
          const outputContent = `衍生资产 ${result.assetId} 已${result.effect === "created" ? "创建" : "更新"}，版本 ${result.revision}`;
          const step = await tx("o_agentRunStep").where({ runId: run.id }).first();
          const attempt = await tx("o_agentRunAttempt").where({ runId: run.id }).first();
          const predecessor = await tx("o_agentRunCheckpoint").where({ runId: run.id }).orderBy("sequence", "desc").first();
          const outputId = dependencies.createId();
          await tx("o_agentToolApproval").where("id", approval.id).update({
            status: "approved", decisionKind: input.decision, decisionCommandId: input.clientCommandId,
            decisionExpectedVersion: input.expectedVersion,
            decidedByUserId: input.actorUserId, decidedAt: now,
          });
          await tx("o_agentToolReceipt").where("id", receipt.id).update({
            status: "succeeded", outputJson, outputHash: hash(outputJson), updatedAt: now,
          });
          await tx("o_agentRunOutput").insert({
            id: outputId, runId: run.id, stepId: step.id, kind: "assistant-text", content: outputContent,
            contentHash: hash(JSON.stringify(outputContent)), schemaVersion: AGENT_RUN_OUTPUT_SCHEMA_VERSION, createdAt: now,
          });
          await tx("o_agentRunStep").where("id", step.id).update({ status: "succeeded", completedAt: now });
          await tx("o_agentRunAttempt").where("id", attempt.id).update({ status: "succeeded", completedAt: now });
          await tx("o_agentRun").where("id", run.id).update({
            status: "succeeded", waitingReason: null, attentionReason: null, allowedActions: JSON.stringify(["inspect"]),
            version: run.version + 1, lastCommittedStepId: step.id, updatedAt: now, completedAt: now,
          });
          const checkpointPayload: AgentRunCheckpointPayload = {
            schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, kind: "step-committed", runId: run.id,
            stepId: step.id, attemptId: attempt.id, sequence: predecessor.sequence + 1,
            runVersion: run.version + 1, lastCommittedStepId: step.id,
            predecessorCheckpointId: predecessor.id, predecessorPayloadHash: predecessor.payloadHash,
            outputId, outputContentHash: hash(JSON.stringify(outputContent)),
          };
          await tx("o_agentRunCheckpoint").insert({
            id: dependencies.createId(), runId: run.id, stepId: step.id, attemptId: attempt.id,
            sequence: checkpointPayload.sequence, kind: "step-committed", schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
            runVersion: checkpointPayload.runVersion, lastCommittedStepId: step.id,
            predecessorCheckpointId: predecessor.id, payload: canonicalCheckpointPayload(checkpointPayload),
            payloadHash: hashCheckpointPayload(checkpointPayload), createdAt: now,
          });
          await addTrace(tx, run.id, receipt.id, "tool.approval.committed", now, dependencies.createId);
        }
        return readSnapshot(tx, input.projectId, run.id);
      }));
    },
  };
}

export function getDefaultDerivedAssetWriteRuntime() {
  return createDerivedAssetWriteRuntime({
    work: (operation) => getDatabaseRuntime().work(operation), now: Date.now, createId: uuid,
  });
}
