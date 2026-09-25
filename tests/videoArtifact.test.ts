import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import knexFactory from "knex";

import { createVideoArtifactRuntime } from "../src/controlledTools/videoArtifact";
import { VideoRequestLedgerConflictError } from
  "../src/controlledTools/videoRequestLedger";
import initDB from "../src/lib/initDB";
import { workOf } from "./databaseTestSupport";

const mp4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d,
  0x6d, 0x70, 0x34, 0x32]);
const encoded = mp4.toString("base64");

async function fixture() {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  await initDB(db);
  await db("o_project").insert({ id: 7, userId: 1 });
  await db("o_agentRun").insert({ id: "run-7", projectId: 7,
    role: "productionAgent", scope: "approved-billable-video-v1",
    clientRequestId: "candidate-7", requestFingerprint: "hash",
    input: "{}", status: "waiting", waitingReason: "vendor-task-observed",
    allowedActions: '["inspect"]', version: 3, createdAt: 100, updatedAt: 100 });
  await db("o_agentRunStep").insert({ id: "step-7", runId: "run-7",
    ordinal: 1, kind: "tool", logicalTarget: "{}",
    promptFingerprint: "hash", status: "running" });
  await db("o_agentRunAttempt").insert({ id: "attempt-7", runId: "run-7",
    stepId: "step-7", ordinal: 1, reason: "initial", status: "running",
    createdAt: 100 });
  await db("o_agentToolReceipt").insert({ id: "receipt-7", runId: "run-7",
    operationId: "operation-7", toolName: "generate_track_video",
    toolRevision: "toonflow.tool.generate-track-video.v1",
    inputHash: "hash", status: "pending", createdAt: 100, updatedAt: 100 });
  await db("o_agentToolApproval").insert({ id: "approval-7", runId: "run-7",
    receiptId: "receipt-7", operationId: "operation-7",
    toolRevision: "toonflow.tool.generate-track-video.v1",
    contractHash: "hash", payloadJson: "{}", payloadHash: "hash",
    targetStateHash: "hash", previewJson: "{}", status: "approved",
    expiresAt: 10_000, createdAt: 100 });
  await db("o_agentToolCall").insert({ id: "call-7", runId: "run-7",
    stepId: "step-7", attemptId: "attempt-7", receiptId: "receipt-7",
    approvalId: "approval-7", toolName: "generate_track_video",
    toolRevision: "toonflow.tool.generate-track-video.v1",
    inputHash: "hash", status: "dispatch_recorded",
    createdAt: 100, updatedAt: 100 });
  await db("o_agentVideoVendorRequest").insert({ id: "request-row-7",
    runId: "run-7", toolCallId: "call-7", projectId: 7, trackId: 31,
    requestId: "request-7", scopeHash: "hash", vendorId: "agnes",
    modelId: "model", commandHash: "command-hash",
    estimatedMaxCostMicros: 250_000, currency: "USD", status: "submitted",
    providerTaskId: "task-7", version: 2, createdAt: 100, updatedAt: 100 });
  const media = new Map<string, Buffer>();
  let failWrite = false;
  let id = 0;
  const artifact = createVideoArtifactRuntime({ work: workOf(db),
    now: () => 200, createId: () => `artifact-${++id}`,
    writeMedia: async (path, base64) => {
      if (failWrite) throw new Error("simulated media write failure");
      media.set(path, Buffer.from(base64, "base64"));
    },
    readMedia: async (path) => {
      const bytes = media.get(path);
      if (!bytes) throw new Error("media missing");
      return bytes;
    } });
  return { db, artifact, media, setFailWrite: (value: boolean) => { failWrite = value; } };
}

test("Video bytes become verified observation, never a Project Video automatically", async () => {
  const context = await fixture();
  const { db, artifact } = context;
  try {
    await assert.rejects(artifact.observe("request-7", "not-base64"),
      VideoRequestLedgerConflictError);
    const observed = await artifact.observe("request-7", encoded);
    assert.equal(observed.status, "observed");
    assert.equal(observed.duplicate, false);
    assert.equal(observed.artifactHash, createHash("sha256").update(mp4).digest("hex"));
    assert.equal((await artifact.observe("request-7", encoded)).duplicate, true);
    assert.equal((await artifact.inspect(7, 1, "request-7"))?.status, "observed");
    await assert.rejects(artifact.inspect(7, 2, "request-7"),
      VideoRequestLedgerConflictError);
    assert.equal((await db("o_video")).length, 0);
    assert.equal((await db("o_agentVideoArtifact")).length, 1);
    const trace = await db("o_agentTrace")
      .where({ eventType: "video-artifact.observed" }).first();
    assert.equal(trace.videoVendorRequestId, "request-row-7");
    assert.equal(trace.videoArtifactId, "artifact-1");
    await assert.rejects(db("o_agentVideoArtifact")
      .where({ id: "artifact-1" }).update({ contentHash: "other" }),
    /identity is immutable/);
  } finally { await db.destroy(); }
});

test("Video media write failure leaves recoverable pending intent without Provider replay", async () => {
  const context = await fixture();
  const { db, artifact, media } = context;
  try {
    context.setFailWrite(true);
    await assert.rejects(artifact.observe("request-7", encoded),
      /simulated media write failure/);
    const pending = await artifact.inspect(7, 1, "request-7");
    assert.equal(pending?.status, "write_pending");
    assert.equal((await db("o_agentVideoVendorRequest")
      .where({ requestId: "request-7" }).first()).status, "submitted");
    assert(pending);
    media.set(pending.mediaPath, mp4);
    context.setFailWrite(false);
    const recovered = await artifact.recoverPending(7, 1, "request-7");
    assert.equal(recovered.status, "observed");
    assert.equal((await db("o_video")).length, 0);
  } finally { await db.destroy(); }
});

test("Video result after cancellation remains late evidence and is not adopted", async () => {
  const context = await fixture();
  const { db, artifact } = context;
  try {
    await db("o_agentRun").where({ id: "run-7" }).update({
      status: "cancelled", waitingReason: null, allowedActions: '["inspect"]' });
    const observed = await artifact.observe("request-7", encoded);
    assert.equal(observed.status, "late");
    assert.equal((await db("o_agentVideoVendorRequest")
      .where({ requestId: "request-7" }).first()).status,
      "late_artifact_observed");
    assert.equal((await db("o_video")).length, 0);
  } finally { await db.destroy(); }
});
