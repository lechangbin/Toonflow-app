import { createHash } from "node:crypto";

import type { ValidatedVideoGenerationCommand } from "@/video/capability";

import type { FrozenVideoApprovalScope } from "./videoApprovalScope";
import type { VideoArtifactObservation } from "./videoArtifact";
import type { VideoArtifactCommitResult } from "./videoArtifactCommit";
import type { VideoRequestReservation } from "./videoRequestLedger";

export type VideoExecutionResult =
  | { status: "already-recorded"; requestId: string; requestStatus: string }
  | { status: "submission-unknown"; requestId: string }
  | { status: "artifact-awaiting-commit"; requestId: string; artifactHash: string }
  | { status: "succeeded"; requestId: string; result: VideoArtifactCommitResult };

export class VideoGenerationExecutionConflictError extends Error {
  constructor() { super("Prepared Video command no longer matches Owner approval"); }
}

/** Internal one-call orchestrator; no route/model adapter is registered. */
export function createVideoGenerationExecution(dependencies: {
  approvedScope(projectId: number, runId: string, approvalId: string,
    actorUserId: number): Promise<FrozenVideoApprovalScope>;
  prepare(scope: FrozenVideoApprovalScope): Promise<{
    vendorId: string; command: ValidatedVideoGenerationCommand;
    commandSnapshot: Record<string, unknown> }>;
  reserve(input: { projectId: number; actorUserId: number;
    runId: string; approvalId: string; expectedVersion: number;
    scope: FrozenVideoApprovalScope }): Promise<VideoRequestReservation>;
  invoke(vendorId: string, command: ValidatedVideoGenerationCommand): Promise<string>;
  markSubmissionAmbiguous(requestId: string): Promise<void>;
  observe(requestId: string, base64: string): Promise<VideoArtifactObservation>;
  currentRunVersion(runId: string, projectId: number): Promise<number>;
  commit(input: { projectId: number; actorUserId: number;
    requestId: string; expectedVersion: number }): Promise<VideoArtifactCommitResult>;
}) {
  return {
    async execute(input: { projectId: number; actorUserId: number;
      runId: string; approvalId: string; expectedVersion: number }): Promise<VideoExecutionResult> {
      const scope = await dependencies.approvedScope(input.projectId,
        input.runId, input.approvalId, input.actorUserId);
      const prepared = await dependencies.prepare(scope);
      const commandHash = createHash("sha256")
        .update(JSON.stringify(prepared.commandSnapshot)).digest("hex");
      if (prepared.vendorId !== scope.payload.item.vendorId
        || prepared.command.modelId !== scope.payload.item.modelId
        || commandHash !== scope.commandHash) {
        throw new VideoGenerationExecutionConflictError();
      }
      const reservation = await dependencies.reserve({ ...input, scope });
      if (!reservation.newIntent) return { status: "already-recorded",
        requestId: reservation.requestId, requestStatus: reservation.status };
      let base64: string;
      try {
        base64 = await dependencies.invoke(prepared.vendorId, prepared.command);
      } catch {
        await dependencies.markSubmissionAmbiguous(reservation.requestId);
        return { status: "submission-unknown", requestId: reservation.requestId };
      }
      let observed: VideoArtifactObservation;
      try {
        observed = await dependencies.observe(reservation.requestId, base64);
      } catch {
        await dependencies.markSubmissionAmbiguous(reservation.requestId);
        return { status: "submission-unknown", requestId: reservation.requestId };
      }
      if (observed.status === "late") return {
        status: "artifact-awaiting-commit", requestId: reservation.requestId,
        artifactHash: observed.artifactHash };
      try {
        const expectedVersion = await dependencies.currentRunVersion(
          input.runId, input.projectId);
        const result = await dependencies.commit({ projectId: input.projectId,
          actorUserId: input.actorUserId,
          requestId: reservation.requestId, expectedVersion });
        return { status: "succeeded", requestId: reservation.requestId, result };
      } catch {
        return { status: "artifact-awaiting-commit",
          requestId: reservation.requestId,
          artifactHash: observed.artifactHash };
      }
    },
  };
}
