import { createHash } from "node:crypto";

import type { Knex } from "knex";

import { AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, canonicalCheckpointPayload,
  hashCheckpointPayload, type AgentRunCheckpointPayload } from "@/agentRuntime";
import { appendCausalTrace } from "@/agentRuntime/causalTrace";
import type { DatabaseWork } from "@/database";

import { VIDEO_GENERATION_TOOL_DEFINITION, toolDefinitionContractHash } from "./definitions";
import { type FrozenVideoApprovalScope,
  type createVideoApprovalScope, frozenVideoApprovalScopeSchema,
  videoApprovalScopeHash } from "./videoApprovalScope";
import { freezeVideoGenerationProposal, videoGenerationProposalInput } from
  "./videoGenerationProposalContract";
import { videoQuoteScopeKey, type VideoQuoteTarget } from "./videoQuotePolicy";

export const VIDEO_GENERATION_APPROVAL_SCOPE = "approved-billable-video-v1";
export const VIDEO_GENERATION_APPROVAL_TTL_MS = 10 * 60_000;
const identifier = /^[A-Za-z0-9._:-]{1,128}$/u;
const tool = VIDEO_GENERATION_TOOL_DEFINITION;
type Scope = ReturnType<typeof createVideoApprovalScope>;
type Status = "pending" | "approved" | "rejected" | "expired";

export class VideoGenerationApprovalConflictError extends Error {
  constructor() { super("Video approval state, target or quote has changed"); }
}

export interface VideoGenerationApprovalSnapshot {
  id: string; runId: string; receiptId: string; operationId: string;
  status: Status; runStatus: string; runVersion: number; expiresAt: number;
  allowedActions: string[]; scopeHash: string;
  payload: FrozenVideoApprovalScope["payload"];
  preview: FrozenVideoApprovalScope["preview"];
  /** No Vendor request exists in this local approval slice. */
  vendorRequest: null;
}

export interface VideoGenerationProposalCommand {
  projectId: number; actorUserId: number; clientRequestId: string;
  operationId: string; payload: unknown;
}

export interface VideoGenerationDecisionCommand {
  projectId: number; actorUserId: number; runId: string; approvalId: string;
  clientCommandId: string; expectedVersion: number; decision: "approve" | "reject";
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function conflict(): never { throw new VideoGenerationApprovalConflictError(); }

async function owner(db: Knex | Knex.Transaction, projectId: number,
  actorUserId: number): Promise<void> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0
    || !Number.isSafeInteger(actorUserId) || actorUserId <= 0
    || !await db("o_project").where({ id: projectId, userId: actorUserId }).first("id")) conflict();
}

function fingerprint(input: VideoGenerationProposalCommand,
  payload: FrozenVideoApprovalScope["payload"]): string {
  return hash({ projectId: input.projectId, actorUserId: input.actorUserId,
    operationId: input.operationId, payload });
}

function parseFrozen(row: { payloadJson: string; payloadHash: string;
  targetStateHash: string; previewJson: string }, projectId: number): FrozenVideoApprovalScope {
  let raw: FrozenVideoApprovalScope;
  let preview: unknown;
  try { raw = JSON.parse(row.payloadJson) as FrozenVideoApprovalScope; }
  catch { return conflict(); }
  if (!frozenVideoApprovalScopeSchema.safeParse(raw).success) conflict();
  try { preview = JSON.parse(row.previewJson); }
  catch { return conflict(); }
  if (!raw || raw.projectId !== projectId || hash(raw) !== row.payloadHash
    || raw.targetStateHash !== row.targetStateHash
    || !raw.preview || hash(raw.preview) !== hash(preview)
    || !raw.quote || !Number.isSafeInteger(raw.quote.revision)
    || raw.quote.revision <= 0 || !Number.isSafeInteger(raw.quote.estimatedMaxCostMicros)
    || raw.quote.estimatedMaxCostMicros <= 0
    || raw.quote.estimatedMaxCostMicros > 1_000_000_000
    || !/^[A-Z]{3}$/u.test(raw.quote.currency)
    || !/^[a-f0-9]{64}$/u.test(raw.scopeHash)
    || raw.scopeHash !== videoApprovalScopeHash(raw)) conflict();
  const parsed = videoGenerationProposalInput.safeParse(raw.payload);
  if (!parsed.success || raw.payloadHash !== hash(parsed.data)
    || raw.preview.payloadHash !== raw.payloadHash
    || raw.quote.projectId !== projectId) conflict();
  try {
    if (videoQuoteScopeKey({ projectId, vendorId: raw.quote.vendorId,
      modelId: raw.quote.modelId, capabilityId: raw.quote.capabilityId,
      output: raw.quote.output, audio: raw.quote.audio }) !== videoQuoteScopeKey({
      projectId, vendorId: parsed.data.item.vendorId, modelId: parsed.data.item.modelId,
      capabilityId: "text-to-video", output: parsed.data.item.output,
      audio: parsed.data.item.audio })) conflict();
  } catch { return conflict(); }
  return raw;
}

async function snapshot(db: Knex | Knex.Transaction, projectId: number,
  runId: string): Promise<VideoGenerationApprovalSnapshot | null> {
  const run = await db("o_agentRun").where({ id: runId, projectId,
    role: "productionAgent", scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first();
  if (!run) return null;
  const approval = await db("o_agentToolApproval").where({ runId }).first();
  const receipt = approval && await db("o_agentToolReceipt")
    .where({ id: approval.receiptId, runId }).first();
  const catalog = await db("o_agentToolDefinition")
    .where({ name: tool.name, revision: tool.revision }).first("contractHash");
  if (!approval || !receipt || catalog?.contractHash !== toolDefinitionContractHash(tool)
    || approval.contractHash !== catalog.contractHash
    || approval.toolRevision !== tool.revision || receipt.toolName !== tool.name
    || receipt.toolRevision !== tool.revision || receipt.operationId !== approval.operationId
    || receipt.inputHash !== approval.payloadHash
    || !["pending", "approved", "rejected", "expired"].includes(approval.status)) conflict();
  const frozen = parseFrozen(approval, projectId);
  let runInput: { operationId?: unknown; scopeHash?: unknown };
  try { runInput = JSON.parse(run.input); } catch { return conflict(); }
  if (runInput.operationId !== approval.operationId
    || runInput.scopeHash !== frozen.scopeHash) conflict();
  if (approval.status === "pending" || approval.status === "approved") {
    if (run.status !== "waiting" || receipt.status !== "pending") conflict();
  } else if (receipt.status !== "cancelled") conflict();
  let allowedActions: string[];
  try { allowedActions = JSON.parse(run.allowedActions); }
  catch { return conflict(); }
  return { id: approval.id, runId, receiptId: receipt.id,
    operationId: approval.operationId, status: approval.status as Status,
    runStatus: run.status, runVersion: run.version, expiresAt: approval.expiresAt,
    allowedActions, scopeHash: frozen.scopeHash,
    payload: frozen.payload, preview: frozen.preview, vendorRequest: null };
}

export async function expireDueVideoGenerationApprovals(db: Knex,
  projectId: number | null, now: number,
  createId: () => string): Promise<void> {
  const query = db("o_agentToolApproval as approval")
    .join("o_agentRun as run", "run.id", "approval.runId")
    .where({ "run.role": "productionAgent",
      "run.scope": VIDEO_GENERATION_APPROVAL_SCOPE, "run.status": "waiting" })
    .whereIn("approval.status", ["pending", "approved"])
    .where("approval.expiresAt", "<=", now).select("approval.id");
  if (projectId !== null) query.where("run.projectId", projectId);
  const due = await query;
  for (const row of due) await db.transaction(async (tx) => {
    const approval = await tx("o_agentToolApproval as approval")
      .join("o_agentRun as run", "run.id", "approval.runId")
      .where({ "approval.id": row.id,
        "run.scope": VIDEO_GENERATION_APPROVAL_SCOPE, "run.status": "waiting" })
      .whereIn("approval.status", ["pending", "approved"])
      .where("approval.expiresAt", "<=", now)
      .select("approval.id", "approval.runId", "approval.receiptId",
        "run.projectId", "run.version").first();
    if (!approval || projectId !== null && approval.projectId !== projectId) return;
    const changed = await tx("o_agentToolApproval").where({ id: approval.id })
      .whereIn("status", ["pending", "approved"]).update({ status: "expired", decidedAt: now });
    const changedRun = await tx("o_agentRun")
      .where({ id: approval.runId, version: approval.version, status: "waiting" })
      .update({ waitingReason: "tool-approval-expired", attentionReason: "new-approval-required",
        allowedActions: JSON.stringify(["inspect"]), version: approval.version + 1, updatedAt: now });
    const changedReceipt = await tx("o_agentToolReceipt")
      .where({ id: approval.receiptId, status: "pending" })
      .update({ status: "cancelled", updatedAt: now });
    if (changed !== 1 || changedRun !== 1 || changedReceipt !== 1) conflict();
    await appendCausalTrace(tx, { id: createId(), runId: approval.runId,
      toolReceiptId: approval.receiptId, eventType: "tool.video-approval.expired",
      createdAt: now });
  });
}

/** Owner-local approval only. No Vendor ToolCall, GenerationTask or dispatch path exists here. */
export function createVideoGenerationApprovalRuntime(dependencies: {
  work: DatabaseWork; now(): number; createId(): string;
  scope: Scope; quoteInTransaction(tx: Knex.Transaction,
    target: VideoQuoteTarget): Promise<{ revision: number; estimatedMaxCostMicros: number; currency: string }>;
  approvalTtlMs?: number;
}) {
  const ttl = dependencies.approvalTtlMs ?? VIDEO_GENERATION_APPROVAL_TTL_MS;
  async function verifyInside(tx: Knex.Transaction, frozen: FrozenVideoApprovalScope) {
    const target = await freezeVideoGenerationProposal(tx, frozen.projectId, frozen.payload);
    if (target.payloadHash !== frozen.payloadHash
      || target.targetStateHash !== frozen.targetStateHash) conflict();
    const item = frozen.payload.item;
    const quote = await dependencies.quoteInTransaction(tx, { projectId: frozen.projectId,
      vendorId: item.vendorId, modelId: item.modelId,
      capabilityId: "text-to-video", output: item.output, audio: item.audio });
    if (quote.revision !== frozen.quote.revision
      || quote.estimatedMaxCostMicros !== frozen.quote.estimatedMaxCostMicros
      || quote.currency !== frozen.quote.currency) conflict();
  }
  return {
    async propose(input: VideoGenerationProposalCommand): Promise<VideoGenerationApprovalSnapshot> {
      if (!identifier.test(input.clientRequestId) || !identifier.test(input.operationId)
        || !Number.isSafeInteger(ttl) || ttl <= 0) conflict();
      const payload = videoGenerationProposalInput.parse(input.payload);
      const requestFingerprint = fingerprint(input, payload);
      const prior = await dependencies.work(async (db) => {
        await owner(db, input.projectId, input.actorUserId);
        return db("o_agentRun").where({ projectId: input.projectId,
          role: "productionAgent", scope: VIDEO_GENERATION_APPROVAL_SCOPE,
          clientRequestId: input.clientRequestId }).first();
      });
      if (prior) {
        if (prior.requestFingerprint !== requestFingerprint) conflict();
        return dependencies.work(async (db) => {
          await expireDueVideoGenerationApprovals(db, input.projectId,
            dependencies.now(), dependencies.createId);
          return await snapshot(db, input.projectId, prior.id) ?? conflict();
        });
      }
      const frozen = await dependencies.scope.prepare(input.projectId, payload);
      return dependencies.work((db) => db.transaction(async (tx) => {
        await owner(tx, input.projectId, input.actorUserId);
        const existing = await tx("o_agentRun").where({ projectId: input.projectId,
          role: "productionAgent", scope: VIDEO_GENERATION_APPROVAL_SCOPE,
          clientRequestId: input.clientRequestId }).first();
        if (existing) {
          if (existing.requestFingerprint !== requestFingerprint) conflict();
          return await snapshot(tx, input.projectId, existing.id) ?? conflict();
        }
        await verifyInside(tx, frozen);
        const now = dependencies.now();
        const contractHash = toolDefinitionContractHash(tool);
        const catalog = await tx("o_agentToolDefinition")
          .where({ name: tool.name, revision: tool.revision }).first("contractHash");
        if (catalog && catalog.contractHash !== contractHash) conflict();
        if (!catalog) await tx("o_agentToolDefinition").insert({ id: dependencies.createId(),
          name: tool.name, revision: tool.revision, contractHash,
          policy: JSON.stringify(tool.policy), createdAt: now });
        const runId = dependencies.createId(), stepId = dependencies.createId();
        const attemptId = dependencies.createId(), receiptId = dependencies.createId();
        const approvalId = dependencies.createId();
        await tx("o_agentRun").insert({ id: runId, projectId: input.projectId,
          scriptId: payload.scriptId, role: "productionAgent", scope: VIDEO_GENERATION_APPROVAL_SCOPE,
          clientRequestId: input.clientRequestId, requestFingerprint,
          input: JSON.stringify({ operationId: input.operationId, scopeHash: frozen.scopeHash }),
          status: "waiting", waitingReason: "tool-approval", attentionReason: "tool-approval-required",
          allowedActions: JSON.stringify(["inspect", "approve", "reject"]), version: 1,
          createdAt: now, updatedAt: now, startedAt: now, fence: 0 });
        await tx("o_agentRunStep").insert({ id: stepId, runId, ordinal: 1, kind: "tool",
          logicalTarget: JSON.stringify({ kind: "tool", name: tool.name }),
          promptFingerprint: requestFingerprint, status: "waiting", startedAt: now });
        await tx("o_agentRunAttempt").insert({ id: attemptId, runId, stepId,
          ordinal: 1, reason: "initial", status: "waiting", createdAt: now, startedAt: now });
        await tx("o_agentToolReceipt").insert({ id: receiptId, runId,
          operationId: input.operationId, toolName: tool.name,
          toolRevision: tool.revision, inputHash: hash(frozen), status: "pending",
          createdAt: now, updatedAt: now });
        await tx("o_agentToolApproval").insert({ id: approvalId, runId, receiptId,
          operationId: input.operationId, toolRevision: tool.revision,
          contractHash, payloadJson: JSON.stringify(frozen), payloadHash: hash(frozen),
          targetStateHash: frozen.targetStateHash, previewJson: JSON.stringify(frozen.preview),
          status: "pending", expiresAt: now + ttl, createdAt: now });
        const checkpoint: AgentRunCheckpointPayload = {
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, kind: "run-created",
          runId, stepId, attemptId, sequence: 1, runVersion: 1,
          lastCommittedStepId: null, predecessorCheckpointId: null,
          predecessorPayloadHash: null, requestFingerprint };
        await tx("o_agentRunCheckpoint").insert({ id: dependencies.createId(), runId,
          stepId, attemptId, sequence: 1, kind: "run-created",
          schemaVersion: checkpoint.schemaVersion, runVersion: 1,
          payload: canonicalCheckpointPayload(checkpoint),
          payloadHash: hashCheckpointPayload(checkpoint), createdAt: now });
        await appendCausalTrace(tx, { id: dependencies.createId(), runId,
          stepId, attemptId, toolReceiptId: receiptId,
          eventType: "tool.video-approval.requested", createdAt: now });
        return await snapshot(tx, input.projectId, runId) ?? conflict();
      }));
    },
    async inspect(projectId: number, runId: string,
      actorUserId: number): Promise<VideoGenerationApprovalSnapshot | null> {
      return dependencies.work(async (db) => {
        await owner(db, projectId, actorUserId);
        await expireDueVideoGenerationApprovals(db, projectId,
          dependencies.now(), dependencies.createId);
        return snapshot(db, projectId, runId);
      });
    },
    async list(projectId: number,
      actorUserId: number): Promise<VideoGenerationApprovalSnapshot[]> {
      return dependencies.work(async (db) => {
        await owner(db, projectId, actorUserId);
        await expireDueVideoGenerationApprovals(db, projectId,
          dependencies.now(), dependencies.createId);
        const rows = await db("o_agentRun").where({ projectId,
          role: "productionAgent", scope: VIDEO_GENERATION_APPROVAL_SCOPE })
          .orderBy("createdAt", "desc").limit(20).select("id");
        const found = await Promise.all(rows.map((row) => snapshot(db, projectId, row.id)));
        return found.filter((row): row is VideoGenerationApprovalSnapshot => row !== null);
      });
    },
    async decide(input: VideoGenerationDecisionCommand): Promise<VideoGenerationApprovalSnapshot | null> {
      if (!identifier.test(input.clientCommandId)
        || !["approve", "reject"].includes(input.decision)
        || !Number.isSafeInteger(input.expectedVersion)
        || input.expectedVersion <= 0) conflict();
      let frozen: FrozenVideoApprovalScope | null = null;
      if (input.decision === "approve") {
        const before = await dependencies.work(async (db) => {
        await owner(db, input.projectId, input.actorUserId);
        const run = await db("o_agentRun").where({ id: input.runId,
          projectId: input.projectId, scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first("id");
        const approval = run && await db("o_agentToolApproval")
          .where({ id: input.approvalId, runId: input.runId }).first();
        if (!approval) return { frozen: null, already: null };
        if (approval.decisionCommandId === input.clientCommandId
          && approval.decisionKind === input.decision
          && approval.decisionExpectedVersion === input.expectedVersion) {
          return { frozen: null, already: await snapshot(db, input.projectId, input.runId) };
        }
        return { frozen: parseFrozen(approval, input.projectId), already: null };
        });
        if (before.already) return before.already;
        frozen = before.frozen;
      }
      if (frozen) await dependencies.scope.recheck(frozen);
      return dependencies.work((db) => db.transaction(async (tx) => {
        await owner(tx, input.projectId, input.actorUserId);
        const run = await tx("o_agentRun").where({ id: input.runId,
          projectId: input.projectId, role: "productionAgent",
          scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first();
        if (!run) return null;
        const approval = await tx("o_agentToolApproval")
          .where({ id: input.approvalId, runId: run.id }).first();
        if (!approval) return null;
        if (approval.decisionCommandId === input.clientCommandId
          && approval.decisionKind === input.decision
          && approval.decisionExpectedVersion === input.expectedVersion) {
          return snapshot(tx, input.projectId, run.id);
        }
        if (approval.status !== "pending" || run.version !== input.expectedVersion
          || approval.expiresAt <= dependencies.now() || run.status !== "waiting") conflict();
        const stored = parseFrozen(approval, input.projectId);
        if (input.decision === "approve") {
          if (!frozen || hash(stored) !== hash(frozen)) conflict();
          await verifyInside(tx, stored);
        }
        const now = dependencies.now();
        const accepted = input.decision === "approve";
        const changed = await tx("o_agentToolApproval")
          .where({ id: approval.id, status: "pending" }).update({
            status: accepted ? "approved" : "rejected", decisionKind: input.decision,
            decisionCommandId: input.clientCommandId, decisionExpectedVersion: input.expectedVersion,
            decidedByUserId: input.actorUserId, decidedAt: now });
        const changedRun = await tx("o_agentRun")
          .where({ id: run.id, status: "waiting", version: run.version }).update({
            status: accepted ? "waiting" : "cancelled",
            waitingReason: accepted ? "video-dispatch-not-enabled" : null,
            attentionReason: accepted ? "video-dispatch-not-enabled" : null,
            allowedActions: JSON.stringify(["inspect"]), version: run.version + 1,
            updatedAt: now, ...(!accepted ? { completedAt: now } : {}) });
        if (changed !== 1 || changedRun !== 1) conflict();
        if (!accepted) {
          const receiptChanged = await tx("o_agentToolReceipt")
            .where({ id: approval.receiptId, status: "pending" })
            .update({ status: "cancelled", updatedAt: now });
          if (receiptChanged !== 1) conflict();
          await tx("o_agentRunStep").where({ runId: run.id }).update({ status: "cancelled", completedAt: now });
          await tx("o_agentRunAttempt").where({ runId: run.id }).update({ status: "cancelled", completedAt: now });
        }
        await appendCausalTrace(tx, { id: dependencies.createId(), runId: run.id,
          toolReceiptId: approval.receiptId,
          eventType: `tool.video-approval.${input.decision}`, createdAt: now });
        return snapshot(tx, input.projectId, run.id);
      }));
    },
  };
}
