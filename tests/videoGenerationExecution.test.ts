import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createVideoGenerationExecution,
  VideoGenerationExecutionConflictError } from
  "../src/controlledTools/videoGenerationExecution";
import type { FrozenVideoApprovalScope } from
  "../src/controlledTools/videoApprovalScope";
import { validatedVideoGenerationCommandSchema } from
  "../src/video/capability";

const command = validatedVideoGenerationCommandSchema.parse({
  capabilityId: "text-to-video", modelId: "model", prompt: "A lantern sways",
  output: { presetId: "720p", duration: 5,
    resolution: "720p", aspectRatio: "16:9" },
  audio: { generation: "native", enabled: true },
});
const commandSnapshot = { capabilityId: command.capabilityId,
  modelId: command.modelId, prompt: command.prompt,
  output: command.output, audio: command.audio };
const commandHash = createHash("sha256")
  .update(JSON.stringify(commandSnapshot)).digest("hex");
const scope: FrozenVideoApprovalScope = { projectId: 7,
  payload: { scriptId: 11, item: { trackId: 31, promptRevisionId: 51,
    vendorId: "agnes", modelId: "model", capabilityId: "text-to-video",
    inputs: [], output: command.output, audio: command.audio } },
  payloadHash: "p".repeat(64), targetStateHash: "t".repeat(64),
  commandHash, scopeHash: "s".repeat(64),
  quote: { projectId: 7, vendorId: "agnes", modelId: "model",
    capabilityId: "text-to-video", output: command.output,
    audio: command.audio, estimatedMaxCostMicros: 250_000,
    currency: "USD", revision: 1, updatedAt: 100 },
  preview: { scriptId: 11, trackId: 31, promptRevisionId: 51,
    vendorId: "agnes", modelId: "model", capabilityId: "text-to-video",
    duration: 5, payloadHash: "p".repeat(64),
    estimatedMaxCostMicros: 250_000, currency: "USD",
    quoteRevision: 1, disclaimer: "local estimate" } };
const input = { projectId: 7, actorUserId: 1,
  runId: "run-7", approvalId: "approval-7", expectedVersion: 2 };

function fixture() {
  const calls: string[] = [];
  let fresh = true;
  let invokeFails = false;
  let commitFails = false;
  let preparedHash = commandHash;
  const execution = createVideoGenerationExecution({
    existingRequest: async () => { calls.push("existingRequest");
      return fresh ? null : { requestId: "request-7",
        vendorRequestId: "vendor-row-7", toolCallId: "call-7",
        status: "succeeded", newIntent: false };
    },
    approvedScope: async () => { calls.push("approvedScope"); return scope; },
    prepare: async () => { calls.push("prepare"); return {
      vendorId: "agnes", command,
      commandSnapshot: preparedHash === commandHash
        ? commandSnapshot : { ...commandSnapshot, prompt: "changed" } }; },
    reserve: async () => { calls.push("reserve"); return {
      requestId: "request-7", vendorRequestId: "vendor-row-7",
      toolCallId: "call-7", status: "dispatch_recorded" as const,
      newIntent: fresh }; },
    invoke: async () => { calls.push("invoke");
      if (invokeFails) throw new Error("timeout");
      return "video-base64";
    },
    markSubmissionAmbiguous: async () => { calls.push("markUnknown"); },
    observe: async () => { calls.push("observe"); return {
      requestId: "request-7", artifactHash: "a".repeat(64),
      mediaPath: "/7/agent-video/request-7/a.mp4",
      status: "observed" as const, duplicate: false }; },
    currentRunVersion: async () => { calls.push("version"); return 4; },
    commit: async () => { calls.push("commit");
      if (commitFails) throw new Error("target changed");
      return { videoId: 9, generationTaskId: 10,
        artifactRevisionId: 11, artifactHash: "a".repeat(64) }; },
  });
  return { execution, calls,
    setFresh: (value: boolean) => { fresh = value; },
    setInvokeFails: (value: boolean) => { invokeFails = value; },
    setCommitFails: (value: boolean) => { commitFails = value; },
    setPreparedHash: (value: string) => { preparedHash = value; } };
}

test("Video execution crosses Provider once only after approved scope and durable intent", async () => {
  const context = fixture();
  const result = await context.execution.execute(input);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(context.calls, ["existingRequest", "approvedScope", "prepare", "reserve",
    "invoke", "observe", "version", "commit"]);
  context.setFresh(false);
  const repeated = await context.execution.execute(input);
  assert.equal(repeated.status, "already-recorded");
  assert.equal(context.calls.filter((call) => call === "invoke").length, 1);
});

test("Video command drift fails before request intent or Provider invocation", async () => {
  const context = fixture();
  context.setPreparedHash("different");
  await assert.rejects(context.execution.execute(input),
    VideoGenerationExecutionConflictError);
  assert.deepEqual(context.calls, ["existingRequest", "approvedScope", "prepare"]);
});

test("Video timeout is unknown and failed local adoption retains observed evidence", async () => {
  const timeout = fixture();
  timeout.setInvokeFails(true);
  assert.equal((await timeout.execution.execute(input)).status, "submission-unknown");
  assert.deepEqual(timeout.calls, ["existingRequest", "approvedScope", "prepare", "reserve",
    "invoke", "markUnknown"]);
  const changed = fixture();
  changed.setCommitFails(true);
  const result = await changed.execution.execute(input);
  assert.equal(result.status, "artifact-awaiting-commit");
  assert.deepEqual(changed.calls, ["existingRequest", "approvedScope", "prepare", "reserve",
    "invoke", "observe", "version", "commit"]);
});
