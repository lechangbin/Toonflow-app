import assert from "node:assert/strict";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import { createStoryboardWriteApprovalRuntime,
  StoryboardApprovalConflictError } from "../src/controlledTools/storyboardWriteApproval";

async function database(): Promise<Knex> {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_project", (t) => {
    t.integer("id").primary(); t.integer("userId");
  });
  await db.schema.createTable("o_script", (t) => {
    t.integer("id").primary(); t.integer("projectId");
  });
  await db.schema.createTable("o_videoTrack", (t) => {
    t.integer("id").primary(); t.integer("projectId"); t.integer("scriptId");
    t.integer("videoId"); t.integer("selectVideoId"); t.integer("duration");
    t.text("vendorId"); t.text("modelId"); t.text("capabilityId");
  });
  await db.schema.createTable("o_assets", (t) => {
    t.integer("id").primary(); t.integer("projectId");
    t.integer("scriptId"); t.integer("assetsId");
  });
  await db.schema.createTable("o_scriptAssets", (t) => {
    t.integer("scriptId"); t.integer("assetId");
  });
  await db.schema.createTable("o_storyboard", (t) => {
    t.increments("id"); t.integer("projectId"); t.integer("scriptId");
    t.integer("trackId"); t.text("videoDesc"); t.text("prompt");
    t.text("duration"); t.text("filePath"); t.text("state");
    t.integer("shouldGenerateImage"); t.integer("createTime");
  });
  await db.schema.createTable("o_assets2Storyboard", (t) => {
    t.integer("storyboardId"); t.integer("assetId");
    t.primary(["storyboardId", "assetId"]);
  });
  await db.schema.createTable("o_agentRun", (t) => {
    t.text("id").primary(); t.integer("projectId"); t.integer("scriptId");
    t.text("role"); t.text("scope"); t.text("clientRequestId");
    t.text("requestFingerprint"); t.text("input"); t.text("status");
    t.text("waitingReason"); t.text("attentionReason"); t.text("allowedActions");
    t.integer("version"); t.integer("createdAt"); t.integer("updatedAt");
    t.integer("startedAt"); t.integer("completedAt"); t.integer("fence");
    t.integer("cancellationRequestedAt"); t.text("lastCommittedStepId");
    t.unique(["projectId", "role", "scope", "clientRequestId"]);
  });
  await db.schema.createTable("o_agentRunStep", (t) => {
    t.text("id").primary(); t.text("runId"); t.integer("ordinal");
    t.text("kind"); t.text("logicalTarget"); t.text("promptFingerprint");
    t.text("status"); t.integer("startedAt"); t.integer("completedAt");
  });
  await db.schema.createTable("o_agentRunAttempt", (t) => {
    t.text("id").primary(); t.text("runId"); t.text("stepId");
    t.integer("ordinal"); t.text("reason"); t.text("status");
    t.integer("createdAt"); t.integer("startedAt"); t.integer("completedAt");
  });
  await db.schema.createTable("o_agentRunCheckpoint", (t) => {
    t.text("id").primary(); t.text("runId"); t.text("stepId");
    t.text("attemptId"); t.integer("sequence"); t.text("kind");
    t.text("schemaVersion"); t.integer("runVersion");
    t.text("lastCommittedStepId"); t.text("predecessorCheckpointId");
    t.text("predecessorPayloadHash"); t.text("payload"); t.text("payloadHash");
    t.integer("createdAt"); t.unique(["runId", "sequence"]);
  });
  await db.schema.createTable("o_agentRunOutput", (t) => {
    t.text("id").primary(); t.text("runId"); t.text("stepId");
    t.text("kind"); t.text("content"); t.text("contentHash");
    t.text("schemaVersion"); t.integer("createdAt");
  });
  await db.schema.createTable("o_agentTrace", (t) => {
    t.text("id").primary(); t.text("runId"); t.text("toolReceiptId");
    t.text("stepId"); t.text("attemptId"); t.text("predecessorTraceId");
    t.integer("sequence"); t.text("eventType"); t.text("diagnostic");
    t.text("diagnosticSchemaVersion"); t.integer("createdAt");
    t.unique(["runId", "sequence"]);
  });
  await db.schema.createTable("o_agentToolDefinition", (t) => {
    t.text("id").primary(); t.text("name"); t.text("revision");
    t.text("contractHash"); t.text("policy"); t.integer("createdAt");
    t.unique(["name", "revision"]);
  });
  await db.schema.createTable("o_agentToolReceipt", (t) => {
    t.text("id").primary(); t.text("runId"); t.text("operationId");
    t.text("toolName"); t.text("toolRevision"); t.text("inputHash");
    t.text("status"); t.text("outputJson"); t.text("outputHash");
    t.text("diagnostic"); t.integer("createdAt"); t.integer("updatedAt");
    t.unique(["runId", "operationId"]);
  });
  await db.schema.createTable("o_agentToolApproval", (t) => {
    t.text("id").primary(); t.text("runId"); t.text("receiptId");
    t.text("operationId"); t.text("toolRevision"); t.text("contractHash");
    t.text("payloadJson"); t.text("payloadHash"); t.text("targetStateHash");
    t.text("previewJson"); t.text("status"); t.integer("expiresAt");
    t.text("decisionKind"); t.text("decisionCommandId");
    t.integer("decisionExpectedVersion"); t.integer("decidedByUserId");
    t.integer("decidedAt"); t.integer("createdAt");
    t.unique(["runId", "operationId"]); t.unique(["receiptId"]);
  });
  await db("o_project").insert([{ id: 7, userId: 1 }, { id: 8, userId: 2 }]);
  await db("o_script").insert([{ id: 11, projectId: 7 }, { id: 12, projectId: 8 }]);
  await db("o_videoTrack").insert({ id: 31, projectId: 7, scriptId: 11,
    duration: 4, vendorId: "vendor", modelId: "video", capabilityId: "text-to-video" });
  await db("o_assets").insert({ id: 21, projectId: 7, scriptId: 11 });
  return db;
}

const payload = { scriptId: 11, trackId: 31, videoDesc: "角色走入庭院",
  prompt: null, duration: 4, shouldGenerateImage: false, associateAssetsIds: [21] };
const proposal = { projectId: 7, actorUserId: 1, clientRequestId: "request-1",
  operationId: "operation-1", payload };
function runtime(db: Knex, now: () => number = () => 100) {
  let next = 0;
  return createStoryboardWriteApprovalRuntime({ work: async (operation) => operation(db),
    now, createId: () => `id-${++next}`, approvalTtlMs: 100 });
}
function decision(pending: { id: string; runId: string; runVersion: number },
  kind: "approve" | "reject" = "approve") {
  return { projectId: 7, actorUserId: 1, runId: pending.runId,
    approvalId: pending.id, clientCommandId: "command-1",
    expectedVersion: pending.runVersion, decision: kind };
}

test("Owner approval commits one Storyboard, associations, receipt, checkpoint and Trace", async () => {
  const db = await database();
  try {
    const write = runtime(db);
    const pending = await write.propose(proposal);
    assert.equal(pending.status, "pending");
    assert.equal((await db("o_storyboard")).length, 0);
    assert.deepEqual(await write.propose(proposal), pending);
    const approved = await write.decide(decision(pending));
    assert.equal(approved?.status, "approved");
    assert.equal(approved?.receiptOutput?.assetCount, 1);
    assert.deepEqual((await db("o_agentRunCheckpoint").orderBy("sequence"))
      .map((row) => row.kind), ["run-created", "step-committed"]);
    assert.deepEqual((await db("o_agentTrace").orderBy("sequence"))
      .map((row) => row.eventType), ["tool.approval.requested", "tool.approval.committed"]);
    assert.deepEqual(await write.decide(decision(pending)), approved);
    assert.deepEqual(await write.propose(proposal), approved);
    assert.equal((await db("o_storyboard")).length, 1);
    assert.equal((await db("o_assets2Storyboard")).length, 1);
  } finally { await db.destroy(); }
});

test("Owner isolation, rejection, expiry and target drift never write a Storyboard", async () => {
  const db = await database();
  let current = 100;
  try {
    const write = runtime(db, () => current);
    await assert.rejects(write.propose({ ...proposal, actorUserId: 2 }));
    const pending = await write.propose(proposal);
    await assert.rejects(write.inspect(7, pending.runId, 2));
    await assert.rejects(write.decide({ ...decision(pending), actorUserId: 2 }));
    await db("o_videoTrack").where({ id: 31 }).update({ modelId: "changed" });
    const conflicted = await write.decide(decision(pending));
    assert.equal(conflicted?.status, "conflicted");
    assert.equal((await db("o_storyboard")).length, 0);
    await assert.rejects(write.decide({ ...decision(pending), clientCommandId: "other" }),
      StoryboardApprovalConflictError);
    await db("o_videoTrack").where({ id: 31 }).update({ modelId: "video" });
    const rejected = await write.propose({ ...proposal, clientRequestId: "request-2",
      operationId: "operation-2" });
    assert.equal((await write.decide(decision(rejected, "reject")))?.status, "rejected");
    const expired = await write.propose({ ...proposal, clientRequestId: "request-3",
      operationId: "operation-3" });
    current = 201;
    assert.equal((await write.inspect(7, expired.runId, 1))?.status, "expired");
    await assert.rejects(write.decide(decision(expired)), StoryboardApprovalConflictError);
    assert.equal((await db("o_storyboard")).length, 0);
  } finally { await db.destroy(); }
});

test("failed association write rolls back approval, receipt and Storyboard together", async () => {
  const db = await database();
  try {
    const write = runtime(db);
    const pending = await write.propose(proposal);
    await db.schema.dropTable("o_assets2Storyboard");
    await assert.rejects(write.decide(decision(pending)));
    assert.equal((await db("o_storyboard")).length, 0);
    assert.equal((await db("o_agentToolApproval").where({ id: pending.id }).first()).status,
      "pending");
    assert.equal((await db("o_agentToolReceipt").where({ id: pending.receiptId }).first()).status,
      "pending");
    assert.equal((await db("o_agentRunCheckpoint")).length, 1);
  } finally { await db.destroy(); }
});
