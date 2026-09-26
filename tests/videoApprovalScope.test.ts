import assert from "node:assert/strict";
import test from "node:test";

import { createVideoApprovalScope, VideoApprovalScopeConflictError } from
  "../src/controlledTools/videoApprovalScope";
import type { ControlledVideoPreparation } from
  "../src/controlledTools/videoGenerationPreparation";
import type { VideoQuoteSnapshot } from "../src/controlledTools/videoQuotePolicy";

const payload: ControlledVideoPreparation["payload"] = { scriptId: 3,
  item: { trackId: 4, promptRevisionId: 5, vendorId: "agnes", modelId: "model",
    capabilityId: "text-to-video", inputs: [], output: { presetId: "720p",
      duration: 5, resolution: "720p", aspectRatio: "16:9" },
    audio: { generation: "native", enabled: true } } };
const prepared: ControlledVideoPreparation = { payload, payloadHash: "p".repeat(64),
  targetStateHash: "t".repeat(64), commandHash: "c".repeat(64),
  preview: { scriptId: 3, trackId: 4, promptRevisionId: 5,
    vendorId: "agnes", modelId: "model", capabilityId: "text-to-video",
    duration: 5, payloadHash: "p".repeat(64) } };
const quote: VideoQuoteSnapshot = { projectId: 7, vendorId: "agnes", modelId: "model",
  capabilityId: "text-to-video", output: payload.item.output,
  audio: payload.item.audio, estimatedMaxCostMicros: 250_000,
  currency: "USD", revision: 2, updatedAt: 100 };

test("Video candidate binds server quote revision and exact prepared hashes", async () => {
  let received: unknown;
  const scope = createVideoApprovalScope({
    prepare: async () => prepared,
    quote: async (target) => { received = target; return quote; },
  });
  const frozen = await scope.prepare(7, payload);
  assert.deepEqual(received, { projectId: 7, vendorId: "agnes", modelId: "model",
    capabilityId: "text-to-video", output: payload.item.output, audio: payload.item.audio });
  assert.equal(frozen.preview.quoteRevision, 2);
  assert.equal(frozen.preview.estimatedMaxCostMicros, 250_000);
  assert.match(frozen.scopeHash, /^[a-f0-9]{64}$/u);
  assert.equal((await scope.recheck(frozen)).scopeHash, frozen.scopeHash);
});

test("Video candidate refuses borrowed or changed estimates and changed target/command", async () => {
  let current = quote;
  let currentPreparation = prepared;
  const scope = createVideoApprovalScope({
    prepare: async () => currentPreparation,
    quote: async () => current,
  });
  const frozen = await scope.prepare(7, payload);
  current = { ...quote, revision: 3 };
  await assert.rejects(scope.recheck(frozen), VideoApprovalScopeConflictError);
  current = quote;
  currentPreparation = { ...prepared, commandHash: "d".repeat(64) };
  await assert.rejects(scope.recheck(frozen), VideoApprovalScopeConflictError);
  currentPreparation = { ...prepared, targetStateHash: "u".repeat(64) };
  await assert.rejects(scope.recheck(frozen), VideoApprovalScopeConflictError);
  currentPreparation = prepared;
  current = { ...quote, output: { ...quote.output, duration: 6 } };
  await assert.rejects(scope.prepare(7, payload), VideoApprovalScopeConflictError);
});
