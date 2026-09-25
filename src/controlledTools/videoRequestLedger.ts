import { createHash } from "node:crypto";

import type { Knex } from "knex";

import { AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, canonicalCheckpointPayload,
  hashCheckpointPayload, parseCheckpointPayload,
  type AgentRunCheckpointPayload } from "@/agentRuntime";
import { appendCausalTrace } from "@/agentRuntime/causalTrace";
import type { DatabaseWork } from "@/database";
import { projectTraceSafeDiagnostic } from "@/diagnostics/traceSafeDiagnostics";

import { VIDEO_GENERATION_TOOL_DEFINITION, toolDefinitionContractHash } from "./definitions";
import { type FrozenVideoApprovalScope,
  frozenVideoApprovalScopeSchema, videoApprovalScopeHash } from "./videoApprovalScope";
import { VIDEO_GENERATION_APPROVAL_SCOPE } from "./videoGenerationApproval";
import { freezeVideoGenerationProposal } from "./videoGenerationProposalContract";
import { type VideoQuoteTarget } from "./videoQuotePolicy";

const tool = VIDEO_GENERATION_TOOL_DEFINITION;

export class VideoRequestLedgerConflictError extends Error {
  constructor() { super("Video request intent conflicts with durable approval or target state"); }
}
function conflict(): never { throw new VideoRequestLedgerConflictError(); }
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export interface VideoRequestReservation {
  requestId: string; vendorRequestId: string; toolCallId: string;
  status: "dispatch_recorded" | "unknown";
  /** True only for the process that inserted the durable intent. No caller is composed yet. */
  newIntent: boolean;
}

const unknownDiagnostic = (() => {
  const projected = projectTraceSafeDiagnostic({ failureClass: "Vendor",
    stage: "vendor-request", kind: "executionFailed", severity: "error",
    certainty: "unknown-effect", expectedness: "unexpected",
    retryDisposition: "reconcile-first" }, "trace");
  if (!projected.ok) throw new Error("Video unknown-effect diagnostic invalid");
  return projected.value;
})();

/** An unacknowledged intent may have crossed the Provider boundary. Never replay it on startup. */
export async function recoverAmbiguousVideoRequests(db: Knex,
  recoveredAt: number, createId: () => string): Promise<void> {
  const rows = await db("o_agentVideoVendorRequest")
    .where({ status: "dispatch_recorded" }).select("id");
  for (const row of rows) await db.transaction(async (tx) => {
    const request = await tx("o_agentVideoVendorRequest")
      .where({ id: row.id, status: "dispatch_recorded" }).first();
    if (!request) return;
    const run = await tx("o_agentRun").where({ id: request.runId,
      projectId: request.projectId, scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first();
    const call = await tx("o_agentToolCall").where({ id: request.toolCallId,
      runId: request.runId }).first();
    if (!run || !call) conflict();
    const changed = await tx("o_agentVideoVendorRequest")
      .where({ id: request.id, status: "dispatch_recorded", version: request.version })
      .update({ status: "unknown", version: request.version + 1,
        updatedAt: recoveredAt });
    const changedRun = await tx("o_agentRun")
      .where({ id: run.id, version: run.version }).update({
        status: "waiting", waitingReason: "vendor-submission-unknown",
        attentionReason: "vendor-reconciliation-required",
        allowedActions: JSON.stringify(["inspect"]), version: run.version + 1,
        updatedAt: recoveredAt });
    if (changed !== 1 || changedRun !== 1) conflict();
    await tx("o_agentRunStep").where({ id: call.stepId }).update({ status: "waiting" });
    await tx("o_agentRunAttempt").where({ id: call.attemptId }).update({ status: "waiting" });
    await appendCausalTrace(tx, { id: createId(), runId: run.id,
      stepId: call.stepId, attemptId: call.attemptId,
      toolReceiptId: call.receiptId, toolCallId: call.id,
      eventType: "vendor.video-request.unknown-on-recovery",
      runStatus: "waiting", stepStatus: "waiting",
      diagnostic: unknownDiagnostic, createdAt: recoveredAt });
  });
}

/** Internal no-replay ledger. The Provider submission adapter is intentionally absent. */
export function createVideoRequestLedger(dependencies: {
  work: DatabaseWork; now(): number; createId(): string;
  recheck(scope: FrozenVideoApprovalScope): Promise<FrozenVideoApprovalScope>;
  quoteInTransaction(tx: Knex.Transaction, target: VideoQuoteTarget): Promise<{
    revision: number; estimatedMaxCostMicros: number; currency: string }>;
}) {
  return {
    async reserve(input: { projectId: number; actorUserId: number;
      runId: string; approvalId: string; expectedVersion: number;
      scope: FrozenVideoApprovalScope }): Promise<VideoRequestReservation> {
      if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion <= 0
        || !frozenVideoApprovalScopeSchema.safeParse(input.scope).success
        || input.scope.projectId !== input.projectId
        || input.scope.scopeHash !== videoApprovalScopeHash(input.scope)) conflict();
      await dependencies.recheck(input.scope);
      return dependencies.work((db) => db.transaction(async (tx) => {
        if (!await tx("o_project").where({ id: input.projectId,
          userId: input.actorUserId }).first("id")) conflict();
        const run = await tx("o_agentRun").where({ id: input.runId,
          projectId: input.projectId, role: "productionAgent",
          scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first();
        const approval = run && await tx("o_agentToolApproval")
          .where({ id: input.approvalId, runId: run.id }).first();
        if (!run || !approval || approval.status !== "approved"
          || approval.expiresAt <= dependencies.now()
          || approval.contractHash !== toolDefinitionContractHash(tool)
          || approval.toolRevision !== tool.revision) conflict();
        let stored: FrozenVideoApprovalScope;
        try { stored = frozenVideoApprovalScopeSchema.parse(JSON.parse(approval.payloadJson)); }
        catch { return conflict(); }
        if (stored.scopeHash !== input.scope.scopeHash
          || videoApprovalScopeHash(stored) !== stored.scopeHash
          || JSON.stringify(stored) !== JSON.stringify(input.scope)
          || approval.payloadHash !== hash(stored)
          || approval.targetStateHash !== stored.targetStateHash) conflict();
        const existingCall = await tx("o_agentToolCall")
          .where({ approvalId: approval.id }).first();
        if (existingCall) {
          const request = await tx("o_agentVideoVendorRequest")
            .where({ toolCallId: existingCall.id, runId: run.id,
              scopeHash: stored.scopeHash }).first();
          if (!request) conflict();
          return { requestId: request.requestId, vendorRequestId: request.id,
            toolCallId: existingCall.id, status: request.status,
            newIntent: false };
        }
        if (run.version !== input.expectedVersion || run.status !== "waiting"
          || run.waitingReason !== "video-dispatch-not-enabled"
          || run.cancellationRequestedAt != null) conflict();
        const receipt = await tx("o_agentToolReceipt")
          .where({ id: approval.receiptId, runId: run.id, status: "pending",
            inputHash: approval.payloadHash, toolName: tool.name,
            toolRevision: tool.revision }).first();
        const step = await tx("o_agentRunStep").where({ runId: run.id, ordinal: 1 }).first();
        const attempt = step && await tx("o_agentRunAttempt")
          .where({ runId: run.id, stepId: step.id, ordinal: 1 }).first();
        const prior = await tx("o_agentRunCheckpoint")
          .where({ runId: run.id }).orderBy("sequence", "desc").first();
        const priorPayload = prior && parseCheckpointPayload(prior.payload);
        if (!receipt || !step || !attempt || !prior || !priorPayload
          || hashCheckpointPayload(priorPayload) !== prior.payloadHash) conflict();
        const frozen = await freezeVideoGenerationProposal(tx,
          input.projectId, stored.payload);
        if (frozen.payloadHash !== stored.payloadHash
          || frozen.targetStateHash !== stored.targetStateHash) conflict();
        const item = stored.payload.item;
        const quote = await dependencies.quoteInTransaction(tx, {
          projectId: input.projectId, vendorId: item.vendorId, modelId: item.modelId,
          capabilityId: "text-to-video", output: item.output, audio: item.audio });
        if (quote.revision !== stored.quote.revision
          || quote.estimatedMaxCostMicros !== stored.quote.estimatedMaxCostMicros
          || quote.currency !== stored.quote.currency) conflict();
        if (await tx("o_agentVideoVendorRequest").where({
          projectId: input.projectId, trackId: item.trackId }).first("id")) conflict();
        const now = dependencies.now();
        const requestId = dependencies.createId();
        const toolCallId = dependencies.createId();
        const vendorRequestId = dependencies.createId();
        const checkpoint: AgentRunCheckpointPayload = {
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
          kind: "vendor-request-intent", runId: run.id,
          stepId: step.id, attemptId: attempt.id,
          sequence: prior.sequence + 1, runVersion: run.version + 1,
          lastCommittedStepId: run.lastCommittedStepId ?? null,
          predecessorCheckpointId: prior.id,
          predecessorPayloadHash: prior.payloadHash,
          requestId, scopeHash: stored.scopeHash };
        await tx("o_agentToolCall").insert({ id: toolCallId, runId: run.id,
          stepId: step.id, attemptId: attempt.id, receiptId: receipt.id,
          approvalId: approval.id, toolName: tool.name, toolRevision: tool.revision,
          inputHash: approval.payloadHash, status: "dispatch_recorded",
          createdAt: now, updatedAt: now });
        await tx("o_agentVideoVendorRequest").insert({ id: vendorRequestId,
          runId: run.id, toolCallId, projectId: input.projectId,
          trackId: item.trackId, requestId, scopeHash: stored.scopeHash,
          vendorId: item.vendorId, modelId: item.modelId,
          commandHash: stored.commandHash,
          estimatedMaxCostMicros: stored.quote.estimatedMaxCostMicros,
          currency: stored.quote.currency, status: "dispatch_recorded",
          version: 1, createdAt: now, updatedAt: now });
        await tx("o_agentRunCheckpoint").insert({ id: dependencies.createId(),
          runId: run.id, stepId: step.id, attemptId: attempt.id,
          sequence: checkpoint.sequence, kind: checkpoint.kind,
          schemaVersion: checkpoint.schemaVersion,
          runVersion: checkpoint.runVersion,
          lastCommittedStepId: checkpoint.lastCommittedStepId,
          predecessorCheckpointId: checkpoint.predecessorCheckpointId,
          payload: canonicalCheckpointPayload(checkpoint),
          payloadHash: hashCheckpointPayload(checkpoint), createdAt: now });
        const changedRun = await tx("o_agentRun").where({ id: run.id,
          version: run.version, status: "waiting" }).update({
            waitingReason: "vendor-request-may-be-in-flight", attentionReason: null,
            allowedActions: JSON.stringify(["inspect"]), version: run.version + 1,
            updatedAt: now });
        if (changedRun !== 1) conflict();
        await tx("o_agentRunStep").where({ id: step.id }).update({ status: "running" });
        await tx("o_agentRunAttempt").where({ id: attempt.id }).update({ status: "running" });
        await appendCausalTrace(tx, { id: dependencies.createId(), runId: run.id,
          stepId: step.id, attemptId: attempt.id, toolReceiptId: receipt.id,
          toolCallId, eventType: "vendor.video-request.intent-recorded",
          runStatus: "waiting", stepStatus: "running", createdAt: now });
        return { requestId, vendorRequestId, toolCallId,
          status: "dispatch_recorded", newIntent: true };
      }));
    },
  };
}
