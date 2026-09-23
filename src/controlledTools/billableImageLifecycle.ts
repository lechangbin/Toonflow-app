import { createHash } from "node:crypto";

import { z } from "zod";

/** A declared ceiling, not a claim about the Provider's final invoice. */
export const billableImageScopeSchema = z.strictObject({
  projectId: z.number().int().positive(),
  assetId: z.number().int().positive(),
  vendorId: z.string().trim().min(1).max(100),
  modelId: z.string().trim().min(1).max(100),
  resolution: z.string().trim().min(1).max(100),
  maxCalls: z.literal(1),
  estimatedMaxCostMicros: z.number().int().nonnegative().safe().max(1_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export type BillableImageScope = z.infer<typeof billableImageScopeSchema>;

export function billableImageScopeHash(scope: BillableImageScope): string {
  const parsed = billableImageScopeSchema.parse(scope);
  return createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}

export type BillableImageStatus =
  | "awaiting_approval"
  | "approved"
  | "dispatch_recorded"
  | "unknown"
  | "submitted"
  | "artifact_observed"
  | "succeeded"
  | "failed_no_effect"
  | "cancelled"
  | "late_artifact_observed";

export interface BillableImageState {
  status: BillableImageStatus;
  scopeHash: string;
  requestId: string;
  providerTaskId: string | null;
  artifactHash: string | null;
  cancellationRequested: boolean;
}

export type BillableImageEvent =
  | { kind: "approve"; scopeHash: string }
  | { kind: "record_dispatch"; requestId: string }
  | { kind: "submission_ambiguous" }
  | { kind: "submission_rejected_without_effect" }
  | { kind: "provider_task_observed"; providerTaskId: string }
  | { kind: "artifact_observed"; artifactHash: string }
  | { kind: "artifact_committed"; artifactHash: string }
  | { kind: "cancel" };

export class BillableImageTransitionError extends Error {
  constructor() {
    super("Billable image transition is not permitted");
    this.name = "BillableImageTransitionError";
  }
}

/** Pure policy: the caller must durably commit each next state before performing its associated effect. */
export function transitionBillableImage(state: BillableImageState, event: BillableImageEvent): BillableImageState {
  const invalid = (): never => { throw new BillableImageTransitionError(); };
  switch (event.kind) {
    case "approve":
      if (state.status !== "awaiting_approval" || event.scopeHash !== state.scopeHash) return invalid();
      return { ...state, status: "approved" };
    case "record_dispatch":
      if (state.status !== "approved" || event.requestId !== state.requestId || state.cancellationRequested) return invalid();
      return { ...state, status: "dispatch_recorded" };
    case "submission_ambiguous":
      if (state.status !== "dispatch_recorded" && state.status !== "cancelled") return invalid();
      return { ...state, status: state.cancellationRequested ? "cancelled" : "unknown" };
    case "submission_rejected_without_effect":
      if (state.status !== "dispatch_recorded") return invalid();
      return { ...state, status: "failed_no_effect" };
    case "provider_task_observed":
      if (!["dispatch_recorded", "unknown", "submitted", "cancelled"].includes(state.status)) return invalid();
      if (!event.providerTaskId || (state.providerTaskId && state.providerTaskId !== event.providerTaskId)) return invalid();
      return { ...state, providerTaskId: event.providerTaskId,
        status: state.cancellationRequested ? "cancelled" : "submitted" };
    case "artifact_observed":
      if (!["dispatch_recorded", "unknown", "submitted", "artifact_observed", "cancelled", "late_artifact_observed", "succeeded"].includes(state.status)) return invalid();
      if (!/^[a-f0-9]{64}$/.test(event.artifactHash) || (state.artifactHash && state.artifactHash !== event.artifactHash)) return invalid();
      if (state.status === "succeeded") return state;
      return { ...state, artifactHash: event.artifactHash,
        status: state.cancellationRequested ? "late_artifact_observed" : "artifact_observed" };
    case "artifact_committed":
      if (state.status !== "artifact_observed" || state.artifactHash !== event.artifactHash || state.cancellationRequested) return invalid();
      return { ...state, status: "succeeded" };
    case "cancel":
      if (["succeeded", "failed_no_effect"].includes(state.status)) return invalid();
      if (state.cancellationRequested) return state;
      return { ...state, cancellationRequested: true,
        status: state.artifactHash ? "late_artifact_observed" : "cancelled" };
  }
}

export function billableImageAllowedActions(state: BillableImageState): readonly string[] {
  switch (state.status) {
    case "awaiting_approval": return ["approve", "reject"];
    case "approved": return ["cancel"];
    case "dispatch_recorded": return ["wait", "cancel"];
    case "unknown": return state.providerTaskId ? ["reconcile_provider_task", "cancel"] : ["wait", "reconcile_manual", "cancel"];
    case "submitted": return ["reconcile_provider_task", "cancel"];
    case "artifact_observed": return ["commit_observed_artifact", "cancel"];
    case "late_artifact_observed": return ["inspect_artifact", "stop_without_replay"];
    case "failed_no_effect": return ["retry_as_new_approval", "stop_without_replay"];
    case "cancelled": return state.providerTaskId ? ["reconcile_provider_task", "stop_without_replay"] : ["wait", "stop_without_replay"];
    case "succeeded": return [];
  }
}
