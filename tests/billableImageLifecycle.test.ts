import assert from "node:assert/strict";
import test from "node:test";

import {
  billableImageAllowedActions,
  billableImageScopeHash,
  transitionBillableImage,
  type BillableImageState,
} from "../src/controlledTools/billableImageLifecycle";

const scope = {
  projectId: 1, assetId: 2, vendorId: "vendor", modelId: "model", resolution: "1024x1024",
  maxCalls: 1 as const, estimatedMaxCostMicros: 250_000, currency: "USD",
};
const initial = (): BillableImageState => ({
  status: "awaiting_approval", scopeHash: billableImageScopeHash(scope), requestId: "request-1",
  providerTaskId: null, artifactHash: null, cancellationRequested: false,
});
const artifactHash = "a".repeat(64);

test("approval binds the exact billable scope and request identity before dispatch", () => {
  assert.notEqual(billableImageScopeHash(scope), billableImageScopeHash({ ...scope, estimatedMaxCostMicros: 250_001 }));
  assert.throws(() => transitionBillableImage(initial(), { kind: "approve", scopeHash: "changed" }));
  const approved = transitionBillableImage(initial(), { kind: "approve", scopeHash: initial().scopeHash });
  assert.throws(() => transitionBillableImage(approved, { kind: "record_dispatch", requestId: "request-2" }));
  const dispatched = transitionBillableImage(approved, { kind: "record_dispatch", requestId: "request-1" });
  assert.equal(dispatched.status, "dispatch_recorded");
  assert.throws(() => transitionBillableImage(dispatched, { kind: "record_dispatch", requestId: "request-1" }));
});

test("ambiguous submission cannot be dispatched again and exposes only reconciliation", () => {
  const approved = transitionBillableImage(initial(), { kind: "approve", scopeHash: initial().scopeHash });
  const dispatched = transitionBillableImage(approved, { kind: "record_dispatch", requestId: "request-1" });
  const unknown = transitionBillableImage(dispatched, { kind: "submission_ambiguous" });
  assert.deepEqual(billableImageAllowedActions(unknown), ["wait", "reconcile_manual", "cancel"]);
  assert.throws(() => transitionBillableImage(unknown, { kind: "record_dispatch", requestId: "request-1" }));
  const found = transitionBillableImage(unknown, { kind: "provider_task_observed", providerTaskId: "task-1" });
  assert.deepEqual(billableImageAllowedActions(found), ["reconcile_provider_task", "cancel"]);
  assert.throws(() => transitionBillableImage(found, { kind: "provider_task_observed", providerTaskId: "task-2" }));
});

test("duplicate artifact callback is idempotent but never changes a completed artifact", () => {
  const dispatched = transitionBillableImage(transitionBillableImage(initial(), { kind: "approve", scopeHash: initial().scopeHash }),
    { kind: "record_dispatch", requestId: "request-1" });
  const observed = transitionBillableImage(dispatched, { kind: "artifact_observed", artifactHash });
  assert.deepEqual(transitionBillableImage(observed, { kind: "artifact_observed", artifactHash }), observed);
  assert.throws(() => transitionBillableImage(observed, { kind: "artifact_observed", artifactHash: "b".repeat(64) }));
  const succeeded = transitionBillableImage(observed, { kind: "artifact_committed", artifactHash });
  assert.equal(succeeded.status, "succeeded");
  assert.deepEqual(transitionBillableImage(succeeded, { kind: "artifact_observed", artifactHash }), succeeded);
  assert.deepEqual(billableImageAllowedActions(succeeded), []);
});

test("cancellation preserves a late artifact without reporting success", () => {
  const dispatched = transitionBillableImage(transitionBillableImage(initial(), { kind: "approve", scopeHash: initial().scopeHash }),
    { kind: "record_dispatch", requestId: "request-1" });
  const cancelled = transitionBillableImage(dispatched, { kind: "cancel" });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(transitionBillableImage(cancelled, { kind: "submission_ambiguous" }).status, "cancelled");
  const late = transitionBillableImage(cancelled, { kind: "artifact_observed", artifactHash });
  assert.equal(late.status, "late_artifact_observed");
  assert.equal(late.artifactHash, artifactHash);
  assert.deepEqual(billableImageAllowedActions(late), ["inspect_artifact", "stop_without_replay"]);
  assert.throws(() => transitionBillableImage(late, { kind: "artifact_committed", artifactHash }));
});

test("known no-effect failure permits only a new approval, not replay", () => {
  const dispatched = transitionBillableImage(transitionBillableImage(initial(), { kind: "approve", scopeHash: initial().scopeHash }),
    { kind: "record_dispatch", requestId: "request-1" });
  const failed = transitionBillableImage(dispatched, { kind: "submission_rejected_without_effect" });
  assert.deepEqual(billableImageAllowedActions(failed), ["retry_as_new_approval", "stop_without_replay"]);
  assert.throws(() => transitionBillableImage(failed, { kind: "record_dispatch", requestId: "request-1" }));
});
