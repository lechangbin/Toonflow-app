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
      videoVendorRequestId: request.id,
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
    /** Verified task observation is durable, but is not a Video Artifact or completion. */
    async recordProviderTask(requestId: string, providerTaskId: string): Promise<void> {
      if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(requestId)
        || !/^[A-Za-z0-9._:-]{1,128}$/u.test(providerTaskId)) conflict();
      await dependencies.work((db) => db.transaction(async (tx) => {
        const request = await tx("o_agentVideoVendorRequest")
          .where({ requestId }).first();
        if (!request) conflict();
        if (request.providerTaskId === providerTaskId) {
          const evidence = await tx("o_agentRunCheckpoint")
            .where({ runId: request.runId, kind: "provider-task-observed" })
            .orderBy("sequence", "desc").first();
          const parsed = evidence && parseCheckpointPayload(evidence.payload,
            "provider-task-observed");
          if (!parsed || parsed.kind !== "provider-task-observed"
            || parsed.requestId !== requestId
            || parsed.providerTaskId !== providerTaskId
            || hashCheckpointPayload(parsed) !== evidence.payloadHash) conflict();
          return;
        }
        if (request.providerTaskId != null
          || !["dispatch_recorded", "unknown", "cancellation_requested"]
            .includes(request.status)) conflict();
        const run = await tx("o_agentRun").where({ id: request.runId,
          projectId: request.projectId,
          scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first();
        const call = await tx("o_agentToolCall").where({ id: request.toolCallId,
          runId: request.runId }).first();
        const prior = await tx("o_agentRunCheckpoint")
          .where({ runId: request.runId }).orderBy("sequence", "desc").first();
        const priorPayload = prior && parseCheckpointPayload(prior.payload);
        if (!run || !call || !prior || !priorPayload
          || hashCheckpointPayload(priorPayload) !== prior.payloadHash) conflict();
        const now = dependencies.now();
        const checkpoint: AgentRunCheckpointPayload = {
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
          kind: "provider-task-observed", runId: run.id,
          stepId: call.stepId, attemptId: call.attemptId,
          sequence: prior.sequence + 1, runVersion: run.version + 1,
          lastCommittedStepId: run.lastCommittedStepId ?? null,
          predecessorCheckpointId: prior.id,
          predecessorPayloadHash: prior.payloadHash,
          requestId, providerTaskId };
        const cancellationPending = request.cancellationRequestedAt != null;
        const stopped = run.status === "cancelled";
        const changed = await tx("o_agentVideoVendorRequest")
          .where({ id: request.id, version: request.version,
            providerTaskId: null })
          .update({ providerTaskId,
            status: cancellationPending ? "cancellation_requested" : "submitted",
            version: request.version + 1, updatedAt: now });
        const changedRun = await tx("o_agentRun")
          .where({ id: run.id, version: run.version }).update({
            waitingReason: cancellationPending || stopped
              ? run.waitingReason : "vendor-task-observed",
            attentionReason: cancellationPending || stopped
              ? run.attentionReason : null,
            allowedActions: cancellationPending || stopped ? run.allowedActions
              : JSON.stringify(["inspect"]), version: run.version + 1,
            updatedAt: now });
        if (changed !== 1 || changedRun !== 1) conflict();
        await tx("o_agentRunCheckpoint").insert({ id: dependencies.createId(),
          runId: run.id, stepId: call.stepId, attemptId: call.attemptId,
          sequence: checkpoint.sequence, kind: checkpoint.kind,
          schemaVersion: checkpoint.schemaVersion,
          runVersion: checkpoint.runVersion,
          lastCommittedStepId: checkpoint.lastCommittedStepId,
          predecessorCheckpointId: checkpoint.predecessorCheckpointId,
          payload: canonicalCheckpointPayload(checkpoint),
          payloadHash: hashCheckpointPayload(checkpoint), createdAt: now });
        await appendCausalTrace(tx, { id: dependencies.createId(), runId: run.id,
          stepId: call.stepId, attemptId: call.attemptId,
          toolReceiptId: call.receiptId, toolCallId: call.id,
          videoVendorRequestId: request.id,
          eventType: "vendor.video-request.task-observed",
          runStatus: run.status,
          stepStatus: stopped ? "cancelled"
            : request.status === "unknown" ? "waiting" : "running",
          createdAt: now });
      }));
    },
    /** Network failure is not proof of no Provider effect. */
    async markSubmissionAmbiguous(requestId: string): Promise<void> {
      if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(requestId)) conflict();
      await dependencies.work((db) => db.transaction(async (tx) => {
        const request = await tx("o_agentVideoVendorRequest")
          .where({ requestId }).first();
        if (!request) conflict();
        if (request.status === "unknown") return;
        if (request.status === "cancellation_requested"
          || request.status === "late_artifact_observed") return;
        if (request.status !== "dispatch_recorded") conflict();
        const run = await tx("o_agentRun").where({ id: request.runId,
          projectId: request.projectId }).first();
        const call = await tx("o_agentToolCall").where({ id: request.toolCallId,
          runId: request.runId }).first();
        if (!run || !call) conflict();
        const now = dependencies.now();
        const changed = await tx("o_agentVideoVendorRequest")
          .where({ id: request.id, version: request.version,
            status: "dispatch_recorded" })
          .update({ status: "unknown", version: request.version + 1,
            updatedAt: now });
        const changedRun = await tx("o_agentRun")
          .where({ id: run.id, version: run.version }).update({
            status: "waiting", waitingReason: "vendor-submission-unknown",
            attentionReason: "vendor-reconciliation-required",
            allowedActions: JSON.stringify(["inspect"]), version: run.version + 1,
            updatedAt: now });
        if (changed !== 1 || changedRun !== 1) conflict();
        await tx("o_agentRunStep").where({ id: call.stepId }).update({ status: "waiting" });
        await tx("o_agentRunAttempt").where({ id: call.attemptId }).update({ status: "waiting" });
        await appendCausalTrace(tx, { id: dependencies.createId(), runId: run.id,
          stepId: call.stepId, attemptId: call.attemptId,
          toolReceiptId: call.receiptId, toolCallId: call.id,
          videoVendorRequestId: request.id,
          eventType: "vendor.video-request.submission-unknown",
          runStatus: "waiting", stepStatus: "waiting",
          diagnostic: unknownDiagnostic, createdAt: now });
      }));
    },
    /** A local cancellation intent is not evidence that the Provider stopped or waived a charge. */
    async requestCancellation(input: { projectId: number; actorUserId: number;
      requestId: string; expectedVersion: number }): Promise<void> {
      if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0
        || !Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0
        || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion <= 0
        || !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.requestId)) conflict();
      await dependencies.work((db) => db.transaction(async (tx) => {
        if (!await tx("o_project").where({ id: input.projectId,
          userId: input.actorUserId }).first("id")) conflict();
        const request = await tx("o_agentVideoVendorRequest")
          .where({ projectId: input.projectId, requestId: input.requestId }).first();
        if (!request) conflict();
        const run = await tx("o_agentRun").where({ id: request.runId,
          projectId: input.projectId, scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first();
        const call = await tx("o_agentToolCall")
          .where({ id: request.toolCallId, runId: request.runId }).first();
        if (!run || !call) conflict();
        if (request.cancellationRequestedAt != null) return;
        if (run.version !== input.expectedVersion || run.status !== "waiting"
          || !["dispatch_recorded", "unknown", "submitted", "artifact_observed"]
            .includes(request.status)) conflict();
        const now = dependencies.now();
        const observed = request.status === "artifact_observed";
        const artifact = observed && await tx("o_agentVideoArtifact")
          .where({ vendorRequestId: request.id, status: "observed" }).first();
        if (observed && !artifact) conflict();
        const changedRequest = await tx("o_agentVideoVendorRequest")
          .where({ id: request.id, version: request.version })
          .update({ status: observed ? "late_artifact_observed" : "cancellation_requested",
            cancellationRequestedAt: now, version: request.version + 1, updatedAt: now });
        if (observed) {
          const changedArtifact = await tx("o_agentVideoArtifact")
            .where({ id: artifact.id, status: "observed" })
            .update({ status: "late", updatedAt: now });
          if (changedArtifact !== 1) conflict();
        }
        const changedRun = await tx("o_agentRun")
          .where({ id: run.id, version: run.version }).update({
            cancellationRequestedAt: now, status: "waiting",
            waitingReason: "vendor-cancellation-unconfirmed",
            attentionReason: "vendor-effect-may-arrive",
            allowedActions: JSON.stringify(["inspect", "stop"]),
            version: run.version + 1, updatedAt: now });
        if (changedRequest !== 1 || changedRun !== 1) conflict();
        await appendCausalTrace(tx, { id: dependencies.createId(), runId: run.id,
          stepId: call.stepId, attemptId: call.attemptId,
          toolReceiptId: call.receiptId, toolCallId: call.id,
          videoVendorRequestId: request.id,
          videoArtifactId: artifact ? artifact.id : undefined,
          eventType: "vendor.video-request.cancellation-requested",
          runStatus: "waiting", createdAt: now });
      }));
    },
    /** Close local execution without replaying or asserting a remote cancellation. */
    async stopWithoutReplay(input: { projectId: number; actorUserId: number;
      requestId: string; expectedVersion: number }): Promise<void> {
      if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0
        || !Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0
        || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion <= 0
        || !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.requestId)) conflict();
      await dependencies.work((db) => db.transaction(async (tx) => {
        if (!await tx("o_project").where({ id: input.projectId,
          userId: input.actorUserId }).first("id")) conflict();
        const request = await tx("o_agentVideoVendorRequest")
          .where({ projectId: input.projectId, requestId: input.requestId }).first();
        if (!request || !["cancellation_requested", "unknown",
          "late_artifact_observed"].includes(request.status)) conflict();
        const run = await tx("o_agentRun").where({ id: request.runId,
          projectId: input.projectId, scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first();
        const call = await tx("o_agentToolCall")
          .where({ id: request.toolCallId, runId: request.runId }).first();
        if (!run || !call) conflict();
        if (run.status === "cancelled" && run.allowedActions === '["inspect"]') return;
        if (run.version !== input.expectedVersion || run.status !== "waiting") conflict();
        const now = dependencies.now();
        const changed = await tx("o_agentRun")
          .where({ id: run.id, version: run.version }).update({
            status: "cancelled", waitingReason: null,
            attentionReason: "vendor-effect-not-disproven",
            allowedActions: JSON.stringify(["inspect"]),
            version: run.version + 1, completedAt: now, updatedAt: now });
        if (changed !== 1) conflict();
        await tx("o_agentToolCall").where({ id: call.id })
          .whereNot("status", "succeeded")
          .update({ status: "cancelled", updatedAt: now });
        await tx("o_agentToolReceipt").where({ id: call.receiptId, status: "pending" })
          .update({ status: "cancelled", updatedAt: now });
        await tx("o_agentRunStep").where({ id: call.stepId })
          .whereNot("status", "succeeded")
          .update({ status: "cancelled", completedAt: now });
        await tx("o_agentRunAttempt").where({ id: call.attemptId })
          .whereNot("status", "succeeded")
          .update({ status: "cancelled", completedAt: now });
        await appendCausalTrace(tx, { id: dependencies.createId(), runId: run.id,
          stepId: call.stepId, attemptId: call.attemptId,
          toolReceiptId: call.receiptId, toolCallId: call.id,
          videoVendorRequestId: request.id,
          eventType: "vendor.video-request.stopped-without-replay",
          runStatus: "cancelled", stepStatus: "cancelled", createdAt: now });
      }));
    },
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
          toolCallId, videoVendorRequestId: vendorRequestId,
          eventType: "vendor.video-request.intent-recorded",
          runStatus: "waiting", stepStatus: "running", createdAt: now });
        return { requestId, vendorRequestId, toolCallId,
          status: "dispatch_recorded", newIntent: true };
      }));
    },
  };
}
