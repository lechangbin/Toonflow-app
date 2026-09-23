import assert from "node:assert/strict";
import test from "node:test";

import { createBillableImageExecution, type BillableImageExecutionDependencies } from "../src/controlledTools/billableImageExecution";

const scope = { projectId: 7, assetId: 10, vendorId: "vendor", modelId: "model", resolution: "1K",
  maxCalls: 1 as const, estimatedMaxCostMicros: 200_000, currency: "USD" };
const input = { projectId: 7, actorUserId: 1, runId: "run", approvalId: "approval", expectedVersion: 2, scope };
const output = { assetId: 10, imageId: 20, artifactHash: "a".repeat(64) };

function fake(overrides: Partial<BillableImageExecutionDependencies> = {}) {
  const events: string[] = [];
  const dependencies: BillableImageExecutionDependencies = {
    prepare: async () => { events.push("prepare"); return { target: { vendorId: "vendor", modelId: "model" },
      input: { prompt: "fresh", size: "1K", aspectRatio: "16:9" } }; },
    preflight: async () => { events.push("preflight"); return "state-hash"; },
    dispatch: async (command) => { events.push(`dispatch:${command.preparedStateHash}`); return {
      requestId: "request", vendorRequestId: "vendor-request", toolCallId: "call", imageId: 20,
      scope, maySubmit: true }; },
    invoke: async () => { events.push("invoke"); return "aGVsbG8="; },
    markSubmissionAmbiguous: async () => { events.push("unknown"); },
    observe: async () => { events.push("observe"); return { requestId: "request", artifactHash: output.artifactHash,
      mediaPath: "/7/agent-image/request/hash.png", status: "observed", duplicate: false }; },
    currentRunVersion: async () => { events.push("version"); return 4; },
    commit: async () => { events.push("commit"); return output; },
    ...overrides,
  };
  return { execute: createBillableImageExecution(dependencies), events };
}

test("one fake Provider success observes media before the atomic commit", async () => {
  const { execute, events } = fake();
  assert.deepEqual(await execute(input), { status: "succeeded", output, requestId: "request" });
  assert.deepEqual(events, ["preflight", "prepare", "preflight", "dispatch:state-hash", "invoke", "observe", "version", "commit"]);
});

test("duplicate/restarted dispatch cannot call the Provider again", async () => {
  const { execute, events } = fake({ dispatch: async () => ({ requestId: "request", vendorRequestId: "vendor-request",
    toolCallId: "call", imageId: 20, scope, maySubmit: false }) });
  assert.deepEqual(await execute(input), { status: "not-dispatched", requestId: "request" });
  assert.deepEqual(events, ["preflight", "prepare", "preflight"]);
});

test("fake Provider timeout is unknown and never retried by the executor", async () => {
  let calls = 0;
  const { execute, events } = fake({ invoke: async () => { calls += 1; events.push("invoke");
    throw new Error("timeout with unknown billable effect"); } });
  assert.deepEqual(await execute(input), { status: "unknown", requestId: "request" });
  assert.equal(calls, 1);
  assert.deepEqual(events, ["preflight", "prepare", "preflight", "dispatch:state-hash", "invoke", "unknown"]);
});

test("late Provider result after cancellation remains attention-required, not success", async () => {
  const { execute, events } = fake({ observe: async () => { events.push("observe-late"); return {
    requestId: "request", artifactHash: output.artifactHash,
    mediaPath: "/7/agent-image/request/hash.png", status: "late", duplicate: false }; } });
  assert.deepEqual(await execute(input), { status: "artifact-needs-attention", requestId: "request" });
  assert.deepEqual(events, ["preflight", "prepare", "preflight", "dispatch:state-hash", "invoke", "observe-late"]);
});

test("post-Provider artifact or commit failure is not mislabeled as no-effect", async () => {
  const { execute } = fake({ commit: async () => { throw new Error("local commit failed"); } });
  assert.deepEqual(await execute(input), { status: "artifact-needs-attention", requestId: "request" });
});
