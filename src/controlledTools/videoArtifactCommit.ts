import { createHash } from "node:crypto";

import { AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
  AGENT_RUN_OUTPUT_SCHEMA_VERSION, canonicalCheckpointPayload,
  hashCheckpointPayload, parseCheckpointPayload,
  type AgentRunCheckpointPayload } from "@/agentRuntime";
import { appendCausalTrace } from "@/agentRuntime/causalTrace";
import type { DatabaseWork } from "@/database";

import { VIDEO_GENERATION_TOOL_DEFINITION, toolDefinitionContractHash } from "./definitions";
import { frozenVideoApprovalScopeSchema, videoApprovalScopeHash } from
  "./videoApprovalScope";
import { VIDEO_GENERATION_APPROVAL_SCOPE } from "./videoGenerationApproval";
import { freezeVideoGenerationProposal } from "./videoGenerationProposalContract";
import { VideoRequestLedgerConflictError } from "./videoRequestLedger";

const tool = VIDEO_GENERATION_TOOL_DEFINITION;
function conflict(): never { throw new VideoRequestLedgerConflictError(); }
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface VideoArtifactCommitResult {
  videoId: number; generationTaskId: number; artifactRevisionId: number;
  artifactHash: string;
}

/** Local atomic adoption of an already observed Video; never contacts a Vendor. */
export function createVideoArtifactCommitRuntime(dependencies: {
  work: DatabaseWork; now(): number; createId(): string;
}) {
  return {
    async commit(input: { projectId: number; actorUserId: number;
      requestId: string; expectedVersion: number }): Promise<VideoArtifactCommitResult> {
      if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0
        || !Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0
        || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion <= 0
        || !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.requestId)) conflict();
      return dependencies.work((db) => db.transaction(async (tx) => {
        if (!await tx("o_project").where({ id: input.projectId,
          userId: input.actorUserId }).first("id")) conflict();
        const request = await tx("o_agentVideoVendorRequest")
          .where({ projectId: input.projectId, requestId: input.requestId }).first();
        if (!request) conflict();
        const artifact = await tx("o_agentVideoArtifact")
          .where({ vendorRequestId: request.id }).first();
        const run = await tx("o_agentRun").where({ id: request.runId,
          projectId: input.projectId, role: "productionAgent",
          scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first();
        const call = run && await tx("o_agentToolCall")
          .where({ id: request.toolCallId, runId: run.id,
            toolName: tool.name, toolRevision: tool.revision }).first();
        if (!artifact || !run || !call) conflict();
        const receipt = await tx("o_agentToolReceipt")
          .where({ id: call.receiptId, runId: run.id }).first();
        if (request.status === "succeeded" && artifact.status === "accepted"
          && run.status === "succeeded" && receipt?.status === "succeeded") {
          let result: VideoArtifactCommitResult;
          try { result = tool.outputSchema.parse(JSON.parse(receipt.outputJson)); }
          catch { return conflict(); }
          if (hash(receipt.outputJson) !== receipt.outputHash
            || result.artifactHash !== artifact.contentHash
            || !await tx("o_video").where({ id: result.videoId,
              projectId: input.projectId, videoTrackId: request.trackId }).first("id")) conflict();
          return result;
        }
        if (run.version !== input.expectedVersion
          || run.status !== "waiting" || run.cancellationRequestedAt != null
          || request.status !== "artifact_observed"
          || artifact.status !== "observed" || !receipt
          || receipt.status !== "pending" || artifact.trackId !== request.trackId
          || artifact.mediaPath !== `/${input.projectId}/agent-video/${input.requestId}/${artifact.contentHash}.mp4`
          || !/^[a-f0-9]{64}$/u.test(artifact.contentHash)) conflict();
        const approval = await tx("o_agentToolApproval")
          .where({ id: call.approvalId, runId: run.id,
            receiptId: receipt.id, status: "approved" }).first();
        if (!approval || approval.contractHash !== toolDefinitionContractHash(tool)
          || approval.toolRevision !== tool.revision
          || approval.payloadHash !== receipt.inputHash) conflict();
        let raw: unknown;
        try { raw = JSON.parse(approval.payloadJson); }
        catch { return conflict(); }
        const parsed = frozenVideoApprovalScopeSchema.safeParse(raw);
        if (!parsed.success) conflict();
        const scope = parsed.data;
        if (scope.projectId !== input.projectId
          || scope.scopeHash !== request.scopeHash
          || scope.scopeHash !== videoApprovalScopeHash(scope)
          || hash(approval.payloadJson) !== approval.payloadHash
          || scope.commandHash !== request.commandHash
          || scope.quote.estimatedMaxCostMicros !== request.estimatedMaxCostMicros
          || scope.quote.currency !== request.currency
          || scope.payload.item.trackId !== request.trackId) conflict();
        const current = await freezeVideoGenerationProposal(tx,
          input.projectId, scope.payload);
        if (current.payloadHash !== scope.payloadHash
          || current.targetStateHash !== scope.targetStateHash
          || approval.targetStateHash !== scope.targetStateHash) conflict();
        const prior = await tx("o_agentRunCheckpoint")
          .where({ runId: run.id }).orderBy("sequence", "desc").first();
        const priorPayload = prior && parseCheckpointPayload(prior.payload);
        if (!prior || !priorPayload
          || hashCheckpointPayload(priorPayload) !== prior.payloadHash
          || !["vendor-request-intent", "provider-task-observed"].includes(prior.kind)) conflict();
        const now = dependencies.now();
        const [actionId] = await tx("o_productionAction").insert({
          projectId: input.projectId, actionType: "generate-video",
          requestedBy: "project-agent", status: "succeeded",
          createdAt: request.createdAt, completedAt: now });
        const [generationTaskId] = await tx("o_generationTask").insert({
          actionId, projectId: input.projectId, videoTrackId: request.trackId,
          vendorId: request.vendorId, modelId: request.modelId,
          capabilityId: "text-to-video",
          promptRevisionId: scope.payload.item.promptRevisionId,
          commandSnapshot: JSON.stringify({ redactedCommandHash: request.commandHash,
            approvalScopeHash: request.scopeHash, requestId: request.requestId }),
          providerTaskSnapshot: request.providerTaskId
            ? JSON.stringify({ providerTaskId: request.providerTaskId }) : null,
          status: "succeeded", startedAt: request.createdAt, completedAt: now });
        const [videoId] = await tx("o_video").insert({
          filePath: artifact.mediaPath, time: now, state: "生成成功",
          scriptId: scope.payload.scriptId, projectId: input.projectId,
          videoTrackId: request.trackId, generationTaskId });
        const revisionRow = await tx("o_artifactRevision")
          .where({ videoTrackId: request.trackId })
          .max<{ revision?: number }>("revision as revision").first();
        const [artifactRevisionId] = await tx("o_artifactRevision").insert({
          actionId, generationTaskId, videoId,
          videoTrackId: request.trackId,
          revision: Number(revisionRow?.revision ?? 0) + 1,
          status: "generated", createdAt: now });
        await tx("o_generationTask").where({ id: generationTaskId })
          .update({ artifactRevisionId });
        await tx("o_video").where({ id: videoId })
          .update({ artifactRevisionId });
        const result: VideoArtifactCommitResult = { videoId,
          generationTaskId, artifactRevisionId,
          artifactHash: artifact.contentHash };
        const output = JSON.stringify(result);
        const outputHash = hash(output);
        const outputId = dependencies.createId();
        const checkpoint: AgentRunCheckpointPayload = {
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
          kind: "step-committed", runId: run.id,
          stepId: call.stepId, attemptId: call.attemptId,
          sequence: prior.sequence + 1, runVersion: run.version + 1,
          lastCommittedStepId: call.stepId,
          predecessorCheckpointId: prior.id,
          predecessorPayloadHash: prior.payloadHash,
          outputId, outputContentHash: outputHash };
        const artifactChanged = await tx("o_agentVideoArtifact")
          .where({ id: artifact.id, status: "observed" })
          .update({ status: "accepted", updatedAt: now });
        const requestChanged = await tx("o_agentVideoVendorRequest")
          .where({ id: request.id, status: "artifact_observed",
            version: request.version })
          .update({ status: "succeeded", version: request.version + 1,
            updatedAt: now });
        const callChanged = await tx("o_agentToolCall")
          .where({ id: call.id, status: "dispatch_recorded" })
          .update({ status: "succeeded", updatedAt: now });
        const receiptChanged = await tx("o_agentToolReceipt")
          .where({ id: receipt.id, status: "pending" })
          .update({ status: "succeeded", outputJson: output,
            outputHash, updatedAt: now });
        if (artifactChanged !== 1 || requestChanged !== 1
          || callChanged !== 1 || receiptChanged !== 1) conflict();
        await tx("o_agentRunOutput").insert({ id: outputId,
          runId: run.id, stepId: call.stepId, kind: "tool",
          content: output, contentHash: outputHash,
          schemaVersion: AGENT_RUN_OUTPUT_SCHEMA_VERSION, createdAt: now });
        await tx("o_agentRunCheckpoint").insert({ id: dependencies.createId(),
          runId: run.id, stepId: call.stepId, attemptId: call.attemptId,
          sequence: checkpoint.sequence, kind: checkpoint.kind,
          schemaVersion: checkpoint.schemaVersion,
          runVersion: checkpoint.runVersion,
          lastCommittedStepId: call.stepId,
          predecessorCheckpointId: checkpoint.predecessorCheckpointId,
          payload: canonicalCheckpointPayload(checkpoint),
          payloadHash: hashCheckpointPayload(checkpoint), createdAt: now });
        await tx("o_agentRunStep").where({ id: call.stepId })
          .update({ status: "succeeded", completedAt: now });
        await tx("o_agentRunAttempt").where({ id: call.attemptId })
          .update({ status: "succeeded", completedAt: now });
        const runChanged = await tx("o_agentRun")
          .where({ id: run.id, status: "waiting", version: run.version })
          .update({ status: "succeeded", waitingReason: null,
            attentionReason: null, allowedActions: "[]",
            lastCommittedStepId: call.stepId,
            version: run.version + 1, updatedAt: now, completedAt: now });
        if (runChanged !== 1) conflict();
        await appendCausalTrace(tx, { id: dependencies.createId(),
          runId: run.id, stepId: call.stepId, attemptId: call.attemptId,
          toolReceiptId: receipt.id, toolCallId: call.id,
          videoVendorRequestId: request.id, videoArtifactId: artifact.id,
          eventType: "tool.video-generation.committed",
          runStatus: "succeeded", stepStatus: "succeeded", createdAt: now });
        return result;
      }));
    },
  };
}
