import { createHash } from "node:crypto";

import type { Knex } from "knex";
import { appendCausalTrace } from "@/agentRuntime/causalTrace";

import {
  AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
  AGENT_RUN_OUTPUT_SCHEMA_VERSION,
  canonicalCheckpointPayload,
  hashCheckpointPayload,
  parseCheckpointPayload,
  type AgentRunCheckpointPayload,
} from "@/agentRuntime";
import type { DatabaseWork } from "@/database";

import { BILLABLE_IMAGE_TOOL_DEFINITION } from "./definitions";
import { billableImageScopeSchema, transitionBillableImage, type BillableImageScope,
  type BillableImageState } from "./billableImageLifecycle";
import { BillableImageLedgerConflictError } from "./billableImageLedger";

export interface BillableImageCommitDependencies {
  work: DatabaseWork;
  now(): number;
  createId(): string;
  verifyPreflight(tx: Knex.Transaction, scope: BillableImageScope): Promise<string>;
}

export interface CommitBillableImageInput {
  projectId: number;
  actorUserId: number;
  requestId: string;
  expectedVersion: number;
}

export interface CommittedBillableImage {
  assetId: number;
  imageId: number;
  artifactHash: string;
}

function conflict(): never { throw new BillableImageLedgerConflictError(); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function stateOf(row: any): BillableImageState {
  return { status: row.status, scopeHash: row.scopeHash, requestId: row.requestId,
    providerTaskId: row.providerTaskId ?? null, artifactHash: row.artifactHash ?? null,
    cancellationRequested: row.cancellationRequestedAt != null };
}

export function createBillableImageCommitRuntime(dependencies: BillableImageCommitDependencies) {
  return {
    async commit(input: CommitBillableImageInput): Promise<CommittedBillableImage> {
      if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0
        || !Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0
        || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion <= 0
        || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId)) return conflict();
      return dependencies.work((db) => db.transaction(async (tx) => {
        if (!await tx("o_project").where({ id: input.projectId, userId: input.actorUserId }).first("id")) return conflict();
        const request = await tx("o_agentVendorRequest").where({ requestId: input.requestId,
          projectId: input.projectId }).first();
        if (!request || !request.artifactHash) return conflict();
        const artifact = await tx("o_agentImageArtifact").where({ vendorRequestId: request.id,
          contentHash: request.artifactHash }).first();
        if (!artifact || !artifact.mediaPath || artifact.imageId !== request.imageId) return conflict();
        const call = await tx("o_agentToolCall").where({ id: request.toolCallId, runId: request.runId,
          toolName: BILLABLE_IMAGE_TOOL_DEFINITION.name }).first();
        const run = await tx("o_agentRun").where({ id: request.runId, projectId: input.projectId,
          role: "productionAgent", scope: "approved-billable-image-v1" }).first();
        if (!call || !run) return conflict();
        if (request.status === "succeeded" && artifact.status === "accepted" && run.status === "succeeded") {
          return { assetId: request.assetId, imageId: request.imageId, artifactHash: request.artifactHash };
        }
        if (run.version !== input.expectedVersion || artifact.status !== "observed"
          || request.cancellationRequestedAt != null || run.cancellationRequestedAt != null) return conflict();
        let next: BillableImageState;
        try { next = transitionBillableImage(stateOf(request), {
          kind: "artifact_committed", artifactHash: request.artifactHash }); }
        catch { return conflict(); }
        const approval = await tx("o_agentToolApproval").where({ id: call.approvalId,
          runId: run.id, receiptId: call.receiptId, status: "approved" }).first();
        if (!approval || approval.payloadHash !== request.scopeHash) return conflict();
        let stored: unknown;
        try { stored = JSON.parse(approval.payloadJson); } catch { return conflict(); }
        const parsed = billableImageScopeSchema.safeParse(stored);
        if (!parsed.success || parsed.data.assetId !== request.assetId || parsed.data.projectId !== input.projectId
          || await dependencies.verifyPreflight(tx, parsed.data) !== approval.targetStateHash) return conflict();
        const image = await tx("o_image").where({ id: request.imageId, assetsId: request.assetId }).first();
        const asset = await tx("o_assets").where({ id: request.assetId, projectId: input.projectId }).first();
        if (!image || !asset || !["等待中", "生成中", "下载中"].includes(image.state)) return conflict();
        const prior = await tx("o_agentRunCheckpoint").where({ runId: run.id }).orderBy("sequence", "desc").first();
        const parsedPrior = prior && parseCheckpointPayload(prior.payload);
        if (!parsedPrior || hashCheckpointPayload(parsedPrior) !== prior.payloadHash
          || !["vendor-request-intent", "provider-task-observed"].includes(prior.kind)) return conflict();
        const now = dependencies.now();
        const output = { assetId: request.assetId, imageId: request.imageId, artifactHash: request.artifactHash };
        const content = JSON.stringify(output);
        const contentHash = hash(content);
        const outputId = dependencies.createId();
        const checkpoint: AgentRunCheckpointPayload = {
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, kind: "step-committed",
          runId: run.id, stepId: call.stepId, attemptId: call.attemptId,
          sequence: prior.sequence + 1, runVersion: run.version + 1,
          lastCommittedStepId: call.stepId, predecessorCheckpointId: prior.id,
          predecessorPayloadHash: prior.payloadHash, outputId, outputContentHash: contentHash,
        };
        const imageChanged = await tx("o_image").where({ id: request.imageId, assetsId: request.assetId })
          .whereIn("state", ["等待中", "生成中", "下载中"]).update({ state: "已完成", filePath: artifact.mediaPath,
            model: request.modelId, resolution: request.resolution });
        if (imageChanged !== 1) return conflict();
        await tx("o_assets").where({ id: request.assetId, projectId: input.projectId }).update({ imageId: request.imageId });
        await tx("o_agentImageArtifact").where({ id: artifact.id, status: "observed" })
          .update({ status: "accepted", updatedAt: now });
        await tx("o_agentVendorRequest").where({ id: request.id, version: request.version }).update({
          status: next.status, version: request.version + 1, updatedAt: now,
        });
        await tx("o_agentToolCall").where({ id: call.id }).update({ status: "succeeded", updatedAt: now });
        const receiptChanged = await tx("o_agentToolReceipt").where({ id: call.receiptId,
          runId: run.id, status: "pending" }).update({ status: "succeeded", outputJson: content,
            outputHash: contentHash, updatedAt: now });
        if (receiptChanged !== 1) return conflict();
        await tx("o_agentRunOutput").insert({ id: outputId, runId: run.id, stepId: call.stepId,
          kind: "tool", content, contentHash, schemaVersion: AGENT_RUN_OUTPUT_SCHEMA_VERSION, createdAt: now });
        await tx("o_agentRunCheckpoint").insert({ id: dependencies.createId(), runId: run.id,
          stepId: call.stepId, attemptId: call.attemptId, sequence: checkpoint.sequence,
          kind: checkpoint.kind, schemaVersion: checkpoint.schemaVersion, runVersion: checkpoint.runVersion,
          lastCommittedStepId: call.stepId, predecessorCheckpointId: checkpoint.predecessorCheckpointId,
          payload: canonicalCheckpointPayload(checkpoint), payloadHash: hashCheckpointPayload(checkpoint), createdAt: now });
        await tx("o_agentRunStep").where({ id: call.stepId }).update({ status: "succeeded", completedAt: now });
        await tx("o_agentRunAttempt").where({ id: call.attemptId }).update({ status: "succeeded", completedAt: now });
        const runChanged = await tx("o_agentRun").where({ id: run.id, version: run.version }).update({
          status: "succeeded", waitingReason: null, attentionReason: null,
          allowedActions: JSON.stringify([]), lastCommittedStepId: call.stepId,
          version: run.version + 1, updatedAt: now, completedAt: now });
        if (runChanged !== 1) return conflict();
        await appendCausalTrace(tx, { id: dependencies.createId(), runId: run.id,
          stepId: call.stepId, attemptId: call.attemptId, toolReceiptId: call.receiptId,
          toolCallId: call.id, vendorRequestId: request.id, imageArtifactId: artifact.id,
          eventType: "tool.billable-image.committed", runStatus: "succeeded", stepStatus: "succeeded", createdAt: now });
        return output;
      }));
    },
  };
}
