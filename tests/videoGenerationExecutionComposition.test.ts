import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import knexFactory from "knex";

import { createVideoGenerationExecutionComposition } from
  "../src/controlledTools/videoGenerationExecutionComposition";
import { createVideoMediaResolver } from
  "../src/controlledTools/videoMediaResolution";
import { recoverInterruptedAgentRuns } from "../src/database/agentRunRecovery";
import initDB from "../src/lib/initDB";
import { VideoPromptProfileRegistry } from "../src/video/promptProfile";
import type { VideoModelSummary } from "../src/vendor";
import { workOf } from "./databaseTestSupport";

const mp4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0x69,
  0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]);
const output = { presetId: "720p", duration: 5,
  resolution: "720p", aspectRatio: "16:9" as const };
const audio = { generation: "native" as const, enabled: true };
const model: VideoModelSummary = { type: "video", name: "Fake Video",
  modelName: "agnes-video-v2.0", capabilities: [{
    id: "text-to-video", promptProfileId: "agnes/text-v1", inputs: [],
    audio: { generation: "native", policy: "always" },
    outputPresets: [{ id: "720p", resolution: "720p",
      durations: { kind: "integer-range", min: 1, max: 18, step: 1 },
      aspectRatios: ["16:9"] }],
  }] };
const payload = { scriptId: 11, item: { trackId: 31, promptRevisionId: 51,
  vendorId: "agnes", modelId: "agnes-video-v2.0",
  capabilityId: "text-to-video" as const, inputs: [], output, audio } };

async function fixture() {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  await initDB(db);
  await db("o_project").insert({ id: 7, userId: 1 });
  await db("o_script").insert({ id: 11, projectId: 7 });
  await db("o_videoTrack").insert({ id: 31, projectId: 7, scriptId: 11,
    state: "已完成", promptRevisionId: 51, duration: 5,
    vendorId: "agnes", modelId: "agnes-video-v2.0",
    capabilityId: "text-to-video", inputRefs: "[]",
    outputSelection: JSON.stringify(output), audioSelection: JSON.stringify(audio) });
  await db("o_promptRevision").insert({ id: 51, projectId: 7,
    videoTrackId: 31, status: "active", profileId: "agnes/text-v1",
    strategy: "custom", brief: "{}", draft: "{}",
    renderedPrompt: "A lantern sways", createdAt: 100 });
  let next = 0;
  let invokes = 0;
  let vendorResult = mp4.toString("base64");
  let failInvoke = false;
  const media = new Map<string, Buffer>();
  const resolveMedia = createVideoMediaResolver({ allowedHosts: [],
    lookup: async () => { throw new Error("no URL allowed"); },
    fetch: async () => { throw new Error("no URL allowed"); } });
  const runtime = createVideoGenerationExecutionComposition({
    work: workOf(db), now: () => 100, createId: () => `video-${++next}`,
    profiles: VideoPromptProfileRegistry.load(path.join(process.cwd(),
      "data", "promptProfiles", "video")),
    vendor: {
      inspectVendor: async () => ({ vendorId: "agnes", name: "Agnes",
        inputs: [], models: [model] }),
      generateVideo: async () => {
        invokes += 1;
        if (failInvoke) throw new Error("Provider timeout");
        return vendorResult;
      },
    },
    resolveMedia,
    writeMedia: async (mediaPath, base64) => {
      media.set(mediaPath, Buffer.from(base64, "base64"));
    },
    readMedia: async (mediaPath) => {
      const bytes = media.get(mediaPath);
      if (!bytes) throw new Error("media missing");
      return bytes;
    },
  });
  await runtime.quote.set({ projectId: 7, actorUserId: 1,
    vendorId: "agnes", modelId: "agnes-video-v2.0",
    capabilityId: "text-to-video", output, audio, expectedRevision: 0,
    estimatedMaxCostMicros: 250_000, currency: "USD" });
  const pending = await runtime.approval.propose({ projectId: 7, actorUserId: 1,
    clientRequestId: "candidate-1", operationId: "operation-1", payload });
  const approved = await runtime.approval.decide({ projectId: 7, actorUserId: 1,
    runId: pending.runId, approvalId: pending.id,
    clientCommandId: "decision-1", expectedVersion: pending.runVersion,
    decision: "approve" });
  assert(approved);
  const execute = { projectId: 7, actorUserId: 1,
    runId: pending.runId, approvalId: pending.id,
    expectedVersion: approved.runVersion };
  return { db, runtime, execute, invokes: () => invokes,
    setVendorResult: (value: string) => { vendorResult = value; },
    setFailInvoke: (value: boolean) => { failInvoke = value; } };
}

test("internal Video composition commits one fake Provider result and never invokes twice", async () => {
  const context = await fixture();
  const { db, runtime, execute } = context;
  try {
    const first = await runtime.execution.execute(execute);
    assert.equal(first.status, "succeeded");
    assert.equal(context.invokes(), 1);
    assert.equal((await db("o_video")).length, 1);
    assert.equal((await runtime.execution.execute(execute)).status, "already-recorded");
    assert.equal(context.invokes(), 1);
    await recoverInterruptedAgentRuns(db, 200);
    assert.equal((await runtime.approval.inspect(7, execute.runId, 1))?.runStatus,
      "succeeded");
  } finally { await db.destroy(); }
});

test("internal Video composition parks fake timeout or untrusted URL without replay", async () => {
  const timeout = await fixture();
  try {
    timeout.setFailInvoke(true);
    assert.equal((await timeout.runtime.execution.execute(timeout.execute)).status,
      "submission-unknown");
    assert.equal((await timeout.runtime.execution.execute(timeout.execute)).status,
      "already-recorded");
    assert.equal(timeout.invokes(), 1);
    assert.equal((await timeout.db("o_video")).length, 0);
  } finally { await timeout.db.destroy(); }
  const url = await fixture();
  try {
    url.setVendorResult("https://unlisted.example.com/video.mp4");
    assert.equal((await url.runtime.execution.execute(url.execute)).status,
      "submission-unknown");
    assert.equal(url.invokes(), 1);
    assert.equal((await url.db("o_video")).length, 0);
  } finally { await url.db.destroy(); }
});
