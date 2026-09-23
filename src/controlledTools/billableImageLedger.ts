import type { Knex } from "knex";

import {
  AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
  canonicalCheckpointPayload,
  hashCheckpointPayload,
  parseCheckpointPayload,
  type AgentRunCheckpointPayload,
} from "@/agentRuntime";
import type { DatabaseWork } from "@/database";

import { BILLABLE_IMAGE_TOOL_DEFINITION, toolDefinitionContractHash } from "./definitions";
import {
  billableImageAllowedActions,
  billableImageScopeHash,
  billableImageScopeSchema,
  transitionBillableImage,
  type BillableImageScope,
  type BillableImageState,
} from "./billableImageLifecycle";

export const BILLABLE_IMAGE_RUN_SCOPE = "approved-billable-image-v1" as const;
export const BILLABLE_IMAGE_RUN_ROLE = "productionAgent" as const;

export interface BillableImageLedgerDependencies {
  work: DatabaseWork;
  now(): number;
  createId(): string;
  /** Re-evaluates ownership, prompt freshness, references and configured target under the dispatch transaction. */
  verifyPreflight(tx: Knex.Transaction, scope: BillableImageScope): Promise<string>;
}

export interface BillableImageDispatchInput {
  projectId: number;
  actorUserId: number;
  runId: string;
  approvalId: string;
  expectedVersion: number;
}

export interface BillableImageDispatch {
  requestId: string;
  vendorRequestId: string;
  toolCallId: string;
  scope: BillableImageScope;
  /** Only the caller that durably created the request may cross the Provider boundary. */
  maySubmit: boolean;
}

export class BillableImageLedgerConflictError extends Error {
  constructor() {
    super("Billable image ledger conflicts with durable approval or Run state");
    this.name = "BillableImageLedgerConflictError";
  }
}

/** Startup/maintenance reconciliation: an intent may have crossed the network boundary. Never submit it again. */
export async function recoverAmbiguousBillableImageRequests(db: Knex, recoveredAt: number): Promise<void> {
  const candidates = await db("o_agentVendorRequest").where({ status: "dispatch_recorded" }).select("id");
  for (const candidate of candidates) {
    await db.transaction(async (tx) => {
      const request = await tx("o_agentVendorRequest").where({ id: candidate.id, status: "dispatch_recorded" }).first();
      if (!request) return;
      const next = transitionBillableImage(stateOf(request), { kind: "submission_ambiguous" });
      const run = await tx("o_agentRun").where({ id: request.runId, projectId: request.projectId }).first();
      const call = await tx("o_agentToolCall").where({ id: request.toolCallId, runId: request.runId }).first();
      if (!run || !call) return reject();
      const changed = await tx("o_agentVendorRequest").where({ id: request.id, status: "dispatch_recorded",
        version: request.version }).update({ status: next.status, version: request.version + 1, updatedAt: recoveredAt });
      if (changed !== 1) return reject();
      const changedRun = await tx("o_agentRun").where({ id: run.id, version: run.version }).update({
        status: "waiting", waitingReason: "vendor-submission-unknown", attentionReason: "vendor-reconciliation-required",
        allowedActions: JSON.stringify(billableImageAllowedActions(next)), version: run.version + 1, updatedAt: recoveredAt,
      });
      if (changedRun !== 1) return reject();
      await tx("o_agentRunStep").where({ id: call.stepId, runId: run.id }).update({ status: "waiting" });
      await tx("o_agentRunAttempt").where({ id: call.attemptId, runId: run.id }).update({ status: "waiting" });
      const latest = await tx("o_agentTrace").where({ runId: run.id }).max<{ sequence?: number }>("sequence as sequence").first();
      await tx("o_agentTrace").insert({ id: `recovery:${request.id}`, runId: run.id, stepId: call.stepId,
        toolReceiptId: call.receiptId, sequence: Number(latest?.sequence ?? 0) + 1,
        eventType: "vendor.request.unknown-on-recovery", runStatus: "waiting", stepStatus: "waiting",
        createdAt: recoveredAt });
    });
  }
}

function reject(): never { throw new BillableImageLedgerConflictError(); }

function stateOf(row: any): BillableImageState {
  return {
    status: row.status, scopeHash: row.scopeHash, requestId: row.requestId,
    providerTaskId: row.providerTaskId ?? null, artifactHash: row.artifactHash ?? null,
    cancellationRequested: row.cancellationRequestedAt != null,
  };
}

function nextCheckpoint(
  prior: any, run: any, step: any, attempt: any, requestId: string, scopeHash: string,
): AgentRunCheckpointPayload {
  const parsed = prior && parseCheckpointPayload(prior.payload);
  if (!parsed || hashCheckpointPayload(parsed) !== prior.payloadHash || prior.runVersion > run.version) return reject();
  return {
    schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, kind: "vendor-request-intent",
    runId: run.id, stepId: step.id, attemptId: attempt.id,
    sequence: prior.sequence + 1, runVersion: run.version + 1,
    lastCommittedStepId: run.lastCommittedStepId ?? null,
    predecessorCheckpointId: prior.id, predecessorPayloadHash: prior.payloadHash,
    requestId, scopeHash,
  };
}

export function createBillableImageLedger(dependencies: BillableImageLedgerDependencies) {
  return {
    async dispatch(input: BillableImageDispatchInput): Promise<BillableImageDispatch> {
      if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0
        || !Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0
        || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion <= 0) return reject();
      return dependencies.work((db) => db.transaction(async (tx) => {
        const project = await tx("o_project").where({ id: input.projectId, userId: input.actorUserId }).first("id");
        if (!project) return reject();
        const run = await tx("o_agentRun").where({ id: input.runId, projectId: input.projectId,
          role: BILLABLE_IMAGE_RUN_ROLE, scope: BILLABLE_IMAGE_RUN_SCOPE }).first();
        if (!run) return reject();
        const approval = await tx("o_agentToolApproval").where({ id: input.approvalId, runId: run.id }).first();
        if (!approval || approval.status !== "approved" || approval.expiresAt <= dependencies.now()
          || approval.toolRevision !== BILLABLE_IMAGE_TOOL_DEFINITION.revision
          || approval.contractHash !== toolDefinitionContractHash(BILLABLE_IMAGE_TOOL_DEFINITION)) return reject();
        let storedPayload: unknown;
        try { storedPayload = JSON.parse(approval.payloadJson); } catch { return reject(); }
        const parsed = billableImageScopeSchema.safeParse(storedPayload);
        if (!parsed.success || parsed.data.projectId !== input.projectId
          || billableImageScopeHash(parsed.data) !== approval.payloadHash) return reject();
        const scope = parsed.data;
        const receipt = await tx("o_agentToolReceipt").where({ id: approval.receiptId, runId: run.id,
          toolName: BILLABLE_IMAGE_TOOL_DEFINITION.name, toolRevision: BILLABLE_IMAGE_TOOL_DEFINITION.revision,
          inputHash: approval.payloadHash }).first();
        if (!receipt) return reject();
        const existingCall = await tx("o_agentToolCall").where({ approvalId: approval.id }).first();
        if (existingCall) {
          const existingRequest = await tx("o_agentVendorRequest").where({ toolCallId: existingCall.id,
            runId: run.id, projectId: input.projectId, scopeHash: approval.payloadHash }).first();
          if (!existingRequest) return reject();
          return { requestId: existingRequest.requestId, vendorRequestId: existingRequest.id,
            toolCallId: existingCall.id, scope, maySubmit: false };
        }
        if (run.version !== input.expectedVersion || run.cancellationRequestedAt != null
          || !["waiting", "running"].includes(run.status) || receipt.status !== "pending") return reject();
        const step = await tx("o_agentRunStep").where({ runId: run.id, ordinal: 1 }).first();
        const attempt = step && await tx("o_agentRunAttempt").where({ runId: run.id, stepId: step.id, ordinal: 1 }).first();
        const prior = await tx("o_agentRunCheckpoint").where({ runId: run.id }).orderBy("sequence", "desc").first();
        if (!step || !attempt || !prior) return reject();
        const currentStateHash = await dependencies.verifyPreflight(tx, scope);
        if (currentStateHash !== approval.targetStateHash) return reject();
        const now = dependencies.now();
        const requestId = dependencies.createId();
        const toolCallId = dependencies.createId();
        const vendorRequestId = dependencies.createId();
        const checkpoint = nextCheckpoint(prior, run, step, attempt, requestId, approval.payloadHash);
        await tx("o_agentToolCall").insert({
          id: toolCallId, runId: run.id, stepId: step.id, attemptId: attempt.id,
          receiptId: receipt.id, approvalId: approval.id, toolName: BILLABLE_IMAGE_TOOL_DEFINITION.name,
          toolRevision: BILLABLE_IMAGE_TOOL_DEFINITION.revision, inputHash: approval.payloadHash,
          status: "dispatch_recorded", createdAt: now, updatedAt: now,
        });
        await tx("o_agentVendorRequest").insert({
          id: vendorRequestId, runId: run.id, toolCallId, projectId: scope.projectId, assetId: scope.assetId,
          requestId, scopeHash: approval.payloadHash, vendorId: scope.vendorId, modelId: scope.modelId,
          resolution: scope.resolution, maxCalls: scope.maxCalls,
          estimatedMaxCostMicros: scope.estimatedMaxCostMicros, currency: scope.currency,
          status: "dispatch_recorded", version: 1, createdAt: now, updatedAt: now,
        });
        await tx("o_agentRunCheckpoint").insert({
          id: dependencies.createId(), runId: run.id, stepId: step.id, attemptId: attempt.id,
          sequence: checkpoint.sequence, kind: checkpoint.kind, schemaVersion: checkpoint.schemaVersion,
          runVersion: checkpoint.runVersion, lastCommittedStepId: checkpoint.lastCommittedStepId,
          predecessorCheckpointId: checkpoint.predecessorCheckpointId,
          payload: canonicalCheckpointPayload(checkpoint), payloadHash: hashCheckpointPayload(checkpoint), createdAt: now,
        });
        const updated = await tx("o_agentRun").where({ id: run.id, version: run.version }).update({
          status: "waiting", waitingReason: "vendor-request-may-be-in-flight",
          attentionReason: null, allowedActions: JSON.stringify(["wait", "cancel"]),
          version: run.version + 1, updatedAt: now,
        });
        if (updated !== 1) return reject();
        await tx("o_agentRunStep").where({ id: step.id }).update({ status: "running" });
        await tx("o_agentRunAttempt").where({ id: attempt.id }).update({ status: "running" });
        return { requestId, vendorRequestId, toolCallId, scope, maySubmit: true };
      }));
    },

    /** Persist a verified Provider task identifier and its checkpoint before any poll is permitted. */
    async recordProviderTask(requestId: string, providerTaskId: string): Promise<void> {
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)
        || !/^[A-Za-z0-9._:-]{1,128}$/.test(providerTaskId)) return reject();
      await dependencies.work((db) => db.transaction(async (tx) => {
        const request = await tx("o_agentVendorRequest").where({ requestId }).first();
        if (!request) return reject();
        if (request.providerTaskId === providerTaskId) {
          const evidence = await tx("o_agentRunCheckpoint").where({ runId: request.runId,
            kind: "provider-task-observed" }).orderBy("sequence", "desc").first();
          const parsedEvidence = evidence && parseCheckpointPayload(evidence.payload, "provider-task-observed");
          if (!parsedEvidence || parsedEvidence.kind !== "provider-task-observed"
            || parsedEvidence.requestId !== requestId || parsedEvidence.providerTaskId !== providerTaskId
            || hashCheckpointPayload(parsedEvidence) !== evidence.payloadHash) return reject();
          return;
        }
        let next: BillableImageState;
        try { next = transitionBillableImage(stateOf(request), { kind: "provider_task_observed", providerTaskId }); }
        catch { return reject(); }
        const call = await tx("o_agentToolCall").where({ id: request.toolCallId, runId: request.runId }).first();
        const run = await tx("o_agentRun").where({ id: request.runId, projectId: request.projectId }).first();
        const prior = await tx("o_agentRunCheckpoint").where({ runId: request.runId }).orderBy("sequence", "desc").first();
        if (!call || !run || !prior) return reject();
        const parsed = parseCheckpointPayload(prior.payload);
        if (!parsed || hashCheckpointPayload(parsed) !== prior.payloadHash
          || prior.runVersion > run.version) return reject();
        const now = dependencies.now();
        const checkpoint: AgentRunCheckpointPayload = {
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, kind: "provider-task-observed",
          runId: run.id, stepId: call.stepId, attemptId: call.attemptId,
          sequence: prior.sequence + 1, runVersion: run.version + 1,
          lastCommittedStepId: run.lastCommittedStepId ?? null,
          predecessorCheckpointId: prior.id, predecessorPayloadHash: prior.payloadHash,
          requestId, providerTaskId,
        };
        const changed = await tx("o_agentVendorRequest").where({ id: request.id, version: request.version,
          providerTaskId: null }).update({ providerTaskId, status: next.status,
          version: request.version + 1, updatedAt: now });
        if (changed !== 1) return reject();
        await tx("o_agentRunCheckpoint").insert({
          id: dependencies.createId(), runId: run.id, stepId: call.stepId, attemptId: call.attemptId,
          sequence: checkpoint.sequence, kind: checkpoint.kind, schemaVersion: checkpoint.schemaVersion,
          runVersion: checkpoint.runVersion, lastCommittedStepId: checkpoint.lastCommittedStepId,
          predecessorCheckpointId: checkpoint.predecessorCheckpointId,
          payload: canonicalCheckpointPayload(checkpoint), payloadHash: hashCheckpointPayload(checkpoint), createdAt: now,
        });
        const changedRun = await tx("o_agentRun").where({ id: run.id, version: run.version }).update({
          version: run.version + 1, updatedAt: now,
          allowedActions: JSON.stringify(billableImageAllowedActions(next)),
          waitingReason: next.status === "submitted" ? "provider-task-awaiting-result" : run.waitingReason,
          attentionReason: next.status === "submitted" ? null : run.attentionReason,
        });
        if (changedRun !== 1) return reject();
      }));
    },

    /** A timeout/reset after dispatch is unknown even if the local image row says failed. */
    async markSubmissionAmbiguous(requestId: string): Promise<void> {
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) return reject();
      await dependencies.work((db) => db.transaction(async (tx) => {
        const request = await tx("o_agentVendorRequest").where({ requestId }).first();
        if (!request) return reject();
        if (request.status === "unknown" || request.status === "cancelled") return;
        let next: BillableImageState;
        try { next = transitionBillableImage(stateOf(request), { kind: "submission_ambiguous" }); }
        catch { return reject(); }
        const now = dependencies.now();
        const changed = await tx("o_agentVendorRequest").where({ id: request.id, version: request.version }).update({
          status: next.status, version: request.version + 1, updatedAt: now,
        });
        if (changed !== 1) return reject();
        const run = await tx("o_agentRun").where({ id: request.runId, projectId: request.projectId }).first();
        if (!run) return reject();
        const changedRun = await tx("o_agentRun").where({ id: run.id, version: run.version }).update({
          status: "waiting", waitingReason: "vendor-submission-unknown", attentionReason: "vendor-reconciliation-required",
          allowedActions: JSON.stringify(billableImageAllowedActions(next)), version: run.version + 1, updatedAt: now,
        });
        if (changedRun !== 1) return reject();
      }));
    },
  };
}
