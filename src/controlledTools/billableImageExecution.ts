import type { ImageGenerationRequest } from "@/vendor";

import type { BillableImageDispatchInput, BillableImageDispatch } from "./billableImageLedger";
import type { BillableImageScope } from "./billableImageLifecycle";
import type { BillableImageArtifactObservation } from "./billableImageArtifact";
import type { CommittedBillableImage } from "./billableImageCommit";

export interface BillableImageExecutionDependencies {
  prepare(scope: BillableImageScope): Promise<ImageGenerationRequest>;
  preflight(scope: BillableImageScope): Promise<string>;
  dispatch(input: BillableImageDispatchInput): Promise<BillableImageDispatch>;
  /** The configured Image Vendor boundary; returns normalized base64 media. */
  invoke(request: ImageGenerationRequest, dispatch: BillableImageDispatch): Promise<string>;
  markSubmissionAmbiguous(requestId: string): Promise<void>;
  observe(requestId: string, base64: string): Promise<BillableImageArtifactObservation>;
  currentRunVersion(runId: string, projectId: number): Promise<number>;
  commit(input: { projectId: number; actorUserId: number; requestId: string;
    expectedVersion: number }): Promise<CommittedBillableImage>;
}

export type BillableImageExecutionResult =
  | { status: "succeeded"; output: CommittedBillableImage; requestId: string }
  | { status: "not-dispatched"; requestId: string }
  | { status: "unknown"; requestId: string }
  | { status: "artifact-needs-attention"; requestId: string };

/** One process-owned submission. Never re-invoke after a durable request identity exists. */
export function createBillableImageExecution(dependencies: BillableImageExecutionDependencies) {
  return async (input: Omit<BillableImageDispatchInput, "preparedStateHash"> & { scope: BillableImageScope }): Promise<BillableImageExecutionResult> => {
    // Everything that can fail safely before billing is prepared before dispatch.
    const beforePreparation = await dependencies.preflight(input.scope);
    const request = await dependencies.prepare(input.scope);
    const preparedStateHash = await dependencies.preflight(input.scope);
    if (beforePreparation !== preparedStateHash) throw new Error("Billable image input changed during preparation");
    const dispatched = await dependencies.dispatch({ projectId: input.projectId,
      actorUserId: input.actorUserId, runId: input.runId, approvalId: input.approvalId,
      expectedVersion: input.expectedVersion, preparedStateHash });
    if (!dispatched.maySubmit) return { status: "not-dispatched", requestId: dispatched.requestId };
    let media: string;
    try { media = await dependencies.invoke(request, dispatched); }
    catch {
      await dependencies.markSubmissionAmbiguous(dispatched.requestId);
      return { status: "unknown", requestId: dispatched.requestId };
    }
    try {
      const observed = await dependencies.observe(dispatched.requestId, media);
      if (observed.status === "late") return { status: "artifact-needs-attention", requestId: dispatched.requestId };
      const version = await dependencies.currentRunVersion(input.runId, input.projectId);
      const output = await dependencies.commit({ projectId: input.projectId, actorUserId: input.actorUserId,
        requestId: dispatched.requestId, expectedVersion: version });
      return { status: "succeeded", output, requestId: dispatched.requestId };
    } catch {
      // The Provider effect was observed or may have completed. Preserve the ledger for reconciliation.
      return { status: "artifact-needs-attention", requestId: dispatched.requestId };
    }
  };
}
