import assert from "node:assert/strict";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import { createAgentRuntime } from "../src/agentRuntime";

import {
  createDerivedAssetWriteRuntime,
  expireDueDerivedAssetApprovals,
  DerivedAssetCommandConflictError,
  DerivedAssetWriteRejectedError,
} from "../src/controlledTools/derivedAssetWrite";
import { recoverPendingControlledTools } from "../src/controlledTools/recovery";

async function database(): Promise<Knex> {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_project", (t) => { t.integer("id").primary(); t.integer("userId"); });
  await db.schema.createTable("o_script", (t) => { t.integer("id").primary(); t.integer("projectId"); });
  await db.schema.createTable("o_assets", (t) => {
    t.increments("id"); t.integer("projectId"); t.integer("assetsId"); t.integer("scriptId");
    t.text("type"); t.text("name"); t.text("describe"); t.integer("startTime");
  });
  await db.schema.createTable("o_scriptAssets", (t) => { t.integer("scriptId"); t.integer("assetId"); });
  await db.schema.createTable("o_derivedChangeInstruction", (t) => {
    t.increments("id"); t.integer("projectId"); t.integer("assetsId").unique(); t.text("source");
    t.integer("revision"); t.text("instruction"); t.integer("createTime"); t.integer("updateTime");
  });
  await db.schema.createTable("o_agentRun", (t) => {
    t.text("id").primary(); t.integer("projectId"); t.integer("scriptId"); t.text("role"); t.text("scope");
    t.text("clientRequestId"); t.text("requestFingerprint"); t.text("input"); t.text("status");
    t.text("waitingReason"); t.text("attentionReason"); t.text("allowedActions"); t.integer("version");
    t.integer("createdAt"); t.integer("updatedAt"); t.integer("startedAt"); t.integer("completedAt");
    t.integer("fence"); t.integer("leaseExpiresAt"); t.text("lastCommittedStepId");
    t.unique(["projectId", "role", "scope", "clientRequestId"]);
  });
  await db.schema.createTable("o_agentRunStep", (t) => {
    t.text("id").primary(); t.text("runId"); t.integer("ordinal"); t.text("kind"); t.text("logicalTarget");
    t.text("promptFingerprint"); t.text("status"); t.integer("startedAt"); t.integer("completedAt");
  });
  await db.schema.createTable("o_agentRunAttempt", (t) => {
    t.text("id").primary(); t.text("runId"); t.text("stepId"); t.integer("ordinal"); t.text("reason");
    t.text("status"); t.integer("createdAt"); t.integer("startedAt"); t.integer("completedAt");
  });
  await db.schema.createTable("o_agentRunCheckpoint", (t) => {
    t.text("id").primary(); t.text("runId"); t.text("stepId"); t.text("attemptId"); t.integer("sequence");
    t.text("kind"); t.text("schemaVersion"); t.integer("runVersion"); t.text("lastCommittedStepId");
    t.text("predecessorCheckpointId"); t.text("payload"); t.text("payloadHash"); t.integer("createdAt");
    t.unique(["runId", "sequence"]); t.unique(["runId", "runVersion"]);
  });
  await db.schema.createTable("o_agentRunOutput", (t) => {
    t.text("id").primary(); t.text("runId"); t.text("stepId"); t.text("kind"); t.text("content");
    t.text("contentHash"); t.text("schemaVersion"); t.integer("createdAt");
  });
  await db.schema.createTable("o_agentTrace", (t) => {
    t.text("id").primary(); t.text("runId"); t.text("toolReceiptId"); t.text("predecessorTraceId"); t.integer("sequence");
    t.text("eventType"); t.text("diagnostic"); t.text("diagnosticSchemaVersion");
    t.integer("createdAt"); t.unique(["runId", "sequence"]);
  });
  await db.schema.createTable("o_agentToolDefinition", (t) => {
    t.text("id").primary(); t.text("name"); t.text("revision"); t.text("contractHash");
    t.text("policy"); t.integer("createdAt"); t.unique(["name", "revision"]);
  });
  await db.schema.createTable("o_agentToolReceipt", (t) => {
    t.text("id").primary(); t.text("runId"); t.text("operationId"); t.text("toolName");
    t.text("toolRevision"); t.text("inputHash"); t.text("status"); t.text("outputJson");
    t.text("outputHash"); t.text("diagnostic"); t.integer("createdAt"); t.integer("updatedAt");
    t.unique(["runId", "operationId"]);
  });
  await db.schema.createTable("o_agentToolApproval", (t) => {
    t.text("id").primary(); t.text("runId"); t.text("receiptId"); t.text("operationId");
    t.text("toolRevision"); t.text("contractHash"); t.text("payloadJson"); t.text("payloadHash");
    t.text("targetStateHash"); t.text("previewJson"); t.text("status"); t.integer("expiresAt");
    t.text("decisionKind"); t.text("decisionCommandId"); t.integer("decisionExpectedVersion");
    t.integer("decidedByUserId"); t.integer("decidedAt"); t.integer("createdAt");
    t.unique(["runId", "operationId"]); t.unique(["receiptId"]);
  });
  await db("o_project").insert([{ id: 7, userId: 1 }, { id: 8, userId: 2 }]);
  await db("o_script").insert([{ id: 70, projectId: 7 }, { id: 80, projectId: 8 }]);
  await db("o_assets").insert([
    { id: 10, projectId: 7, assetsId: null, scriptId: 70, type: "role", name: "角色" },
    { id: 20, projectId: 8, assetsId: null, scriptId: 80, type: "role", name: "隔离角色" },
  ]);
  return db;
}

const instruction = {
  dimensions: ["wardrobe"], evidence: ["剧本第 1 场更换外套"],
  preserve: ["面部身份"], change: ["外套改为蓝色"], exclude: [],
};
const payload = { parentAssetId: 10, assetId: null, expectedVersion: 0, scriptId: 70,
  name: "蓝衣角色", description: "换装版本", changeInstruction: instruction };
const proposal = { projectId: 7, actorUserId: 1, clientRequestId: "request-1", operationId: "operation-1", payload };
function runtime(db: Knex, now: () => number = () => 100) {
  let next = 0;
  return createDerivedAssetWriteRuntime({ work: async (operation) => operation(db), now,
    createId: () => `id-${++next}`, approvalTtlMs: 100 });
}
function decision(snapshot: { runId: string; id: string; runVersion: number }, kind: "approve" | "reject" = "approve") {
  return { projectId: 7, runId: snapshot.runId, approvalId: snapshot.id,
    clientCommandId: "command-1", expectedVersion: snapshot.runVersion, actorUserId: 1, decision: kind };
}

test("approval atomically commits one Derived Asset, instruction, receipt, checkpoint and Trace", async () => {
  const db = await database();
  try {
    const write = runtime(db);
    const pending = await write.propose(proposal);
    assert.deepEqual(pending.allowedActions, ["inspect", "approve", "reject"]);
    assert.equal(pending.preview.expectedVersion, 0);
    assert.deepEqual((await write.list(7, 1)).map((approval) => approval.id), [pending.id]);
    assert.deepEqual(await write.list(8, 2), []);
    assert.equal((await db("o_assets")).length, 2);
    const approved = await write.decide(decision(pending));
    assert.equal(approved?.status, "approved");
    assert.equal(approved?.runStatus, "succeeded");
    assert.equal(approved?.receiptStatus, "succeeded");
    assert.equal(approved?.receiptOutput?.revision, 1);
    assert.equal((await db("o_assets")).length, 3);
    assert.equal((await db("o_derivedChangeInstruction")).length, 1);
    assert.deepEqual((await db("o_agentRunCheckpoint").orderBy("sequence")).map((row) => row.kind), ["run-created", "step-committed"]);
    const traces = await db("o_agentTrace").orderBy("sequence");
    assert.deepEqual(traces.map((row) => row.eventType), ["tool.approval.requested", "tool.approval.committed"]);
    assert.equal(traces[1].predecessorTraceId, traces[0].id);
    assert.deepEqual(await write.decide(decision(pending)), approved);
    assert.equal((await db("o_assets")).length, 3, "duplicate approval must not create another asset");
    assert.deepEqual(await write.propose(proposal), approved, "duplicate proposal projects the durable result");
  } finally { await db.destroy(); }
});

test("cross-Project, malformed and wrong target versions fail before a proposal is persisted", async () => {
  const db = await database();
  try {
    const write = runtime(db);
    await assert.rejects(write.propose({ ...proposal, payload: { ...payload, parentAssetId: 20 } }), DerivedAssetWriteRejectedError);
    await assert.rejects(write.propose({ ...proposal, payload: { ...payload, expectedVersion: 1 } }), DerivedAssetWriteRejectedError);
    await assert.rejects(write.propose({ ...proposal, payload: { ...payload, changeInstruction: { ...instruction, evidence: [] } } }), DerivedAssetWriteRejectedError);
    await assert.rejects(write.propose({ ...proposal, payload: { ...payload, extra: true } }), DerivedAssetWriteRejectedError);
    await assert.rejects(write.propose({ ...proposal, actorUserId: 2 }), DerivedAssetWriteRejectedError);
    assert.equal((await db("o_agentRun")).length, 0);
    assert.equal((await db("o_agentToolApproval")).length, 0);
  } finally { await db.destroy(); }
});

test("the Project owner gate applies to list, inspect and approval commands", async () => {
  const db = await database();
  try {
    const write = runtime(db);
    const pending = await write.propose(proposal);
    await assert.rejects(write.list(7, 2), DerivedAssetWriteRejectedError);
    await assert.rejects(write.inspect(7, pending.runId, 2), DerivedAssetWriteRejectedError);
    await assert.rejects(write.decide({ ...decision(pending), actorUserId: 2 }), DerivedAssetWriteRejectedError);
    assert.equal((await db("o_assets")).length, 2);
  } finally { await db.destroy(); }
});

test("rejection and expiry preserve safe inspectable state without production writes", async () => {
  const db = await database();
  let current = 100;
  try {
    const write = runtime(db, () => current);
    const rejected = await write.propose(proposal);
    const afterReject = await write.decide(decision(rejected, "reject"));
    assert.equal(afterReject?.status, "rejected");
    assert.equal(afterReject?.runStatus, "cancelled");
    const other = await write.propose({ ...proposal, clientRequestId: "request-2", operationId: "operation-2" });
    current = 201;
    const afterExpiry = await write.decide(decision(other));
    assert.equal(afterExpiry?.status, "expired");
    assert.deepEqual(afterExpiry?.allowedActions, ["inspect"]);
    assert.equal((await db("o_assets")).length, 2);
    assert.equal((await db("o_derivedChangeInstruction")).length, 0);
  } finally { await db.destroy(); }
});

test("concurrent target changes and tampered proposal evidence cannot be approved", async () => {
  const db = await database();
  try {
    const write = runtime(db);
    const pending = await write.propose(proposal);
    await db("o_assets").where({ id: 10 }).update({ type: "scene" });
    const conflicted = await write.decide(decision(pending));
    assert.equal(conflicted?.status, "conflicted");
    assert.equal((await db("o_assets")).length, 2);
    const second = await write.propose({ ...proposal, clientRequestId: "request-2", operationId: "operation-2",
      payload: { ...payload, parentAssetId: 10, changeInstruction: { ...instruction, dimensions: ["time_of_day"] } } });
    await db("o_agentToolApproval").where({ id: second.id }).update({ payloadJson: "{}" });
    assert.equal((await write.inspect(7, second.runId, 1))?.status, "corrupt");
    const corrupt = await write.decide(decision(second));
    assert.equal(corrupt?.status, "corrupt");
    assert.equal((await db("o_assets")).length, 2);
  } finally { await db.destroy(); }
});

test("stale approval commands and duplicate proposal identity never switch the approved payload", async () => {
  const db = await database();
  try {
    const write = runtime(db);
    const pending = await write.propose(proposal);
    await assert.rejects(write.propose({ ...proposal, payload: { ...payload, name: "changed" } }), DerivedAssetCommandConflictError);
    await assert.rejects(write.decide({ ...decision(pending), expectedVersion: 9 }), DerivedAssetCommandConflictError);
    assert.equal((await db("o_assets")).length, 2);
  } finally { await db.destroy(); }
});

test("a newly committed equivalent visual state invalidates a second pending approval", async () => {
  const db = await database();
  try {
    const write = runtime(db);
    const first = await write.propose(proposal);
    const second = await write.propose({ ...proposal, clientRequestId: "request-2", operationId: "operation-2" });
    await write.decide(decision(first));
    const conflicted = await write.decide({ ...decision(second), clientCommandId: "command-2" });
    assert.equal(conflicted?.status, "conflicted");
    assert.equal((await db("o_assets")).length, 3);
    assert.equal((await db("o_derivedChangeInstruction")).length, 1);
  } finally { await db.destroy(); }
});

test("updates require the current instruction revision and increment it exactly once", async () => {
  const db = await database();
  try {
    await db("o_assets").insert({ id: 30, projectId: 7, assetsId: 10, scriptId: 70,
      type: "role", name: "旧名称", describe: "旧描述" });
    await db("o_derivedChangeInstruction").insert({
      projectId: 7, assetsId: 30, source: "agent", revision: 2,
      instruction: JSON.stringify({ ...instruction, change: ["外套改为红色"] }), createTime: 1, updateTime: 2,
    });
    const write = runtime(db);
    const pending = await write.propose({ ...proposal, payload: { ...payload, assetId: 30, expectedVersion: 2 } });
    const approved = await write.decide(decision(pending));
    assert.deepEqual(approved?.receiptOutput, { assetId: 30, revision: 3, effect: "updated" });
    assert.equal((await db("o_derivedChangeInstruction").where({ assetsId: 30 }).first()).revision, 3);
    assert.equal((await db("o_assets").where({ id: 30 }).first()).name, "蓝衣角色");
    assert.equal((await db("o_assets")).length, 3);
  } finally { await db.destroy(); }
});

test("a failed instruction insert rolls back the Asset and leaves the approval pending", async () => {
  const db = await database();
  try {
    const write = runtime(db);
    const pending = await write.propose(proposal);
    await db.raw(`CREATE TRIGGER reject_instruction BEFORE INSERT ON o_derivedChangeInstruction
      BEGIN SELECT RAISE(ABORT, 'injected instruction failure'); END`);
    await assert.rejects(write.decide(decision(pending)), /injected instruction failure/);
    assert.equal((await db("o_assets")).length, 2);
    assert.equal((await db("o_derivedChangeInstruction")).length, 0);
    assert.equal((await write.inspect(7, pending.runId, 1))?.status, "pending");
    assert.equal((await db("o_agentRunCheckpoint")).length, 1);
    assert.equal((await db("o_agentTrace")).length, 1);
  } finally { await db.destroy(); }
});

test("the shared Agent Run inspector reprojects approval and committed checkpoint after restart", async () => {
  const db = await database();
  try {
    const write = runtime(db);
    const pending = await write.propose(proposal);
    const agent = createAgentRuntime({ work: async (operation) => operation(db),
      openTextCall: async () => { throw new Error("model must not execute"); },
      schedule: () => { throw new Error("scheduler must not execute"); },
      now: () => 100, createId: () => "unused" });
    assert.equal((await agent.inspect({ projectId: 7, runId: pending.runId }))?.status, "waiting");
    await write.decide(decision(pending));
    const restored = await agent.inspect({ projectId: 7, runId: pending.runId });
    assert.equal(restored?.status, "succeeded");
    assert.deepEqual(restored?.checkpoints.map((checkpoint) => checkpoint.kind), ["run-created", "step-committed"]);
    assert.equal(restored?.outputs.length, 1);
  } finally { await db.destroy(); }
});

test("read Tool recovery does not consume a pending human approval after restart", async () => {
  const db = await database();
  try {
    const write = runtime(db);
    const pending = await write.propose(proposal);
    await recoverPendingControlledTools(db, 150);
    assert.equal((await write.inspect(7, pending.runId, 1))?.receiptStatus, "pending");
    assert.equal((await write.decide(decision(pending)))?.status, "approved");
  } finally { await db.destroy(); }
});

test("an expired approval settles durably on inspection without a browser decision", async () => {
  const db = await database();
  let current = 100;
  try {
    const write = runtime(db, () => current);
    const pending = await write.propose(proposal);
    current = 201;
    const expired = await write.inspect(7, pending.runId, 1);
    assert.equal(expired?.status, "expired");
    assert.equal(expired?.receiptStatus, "failed");
    assert.deepEqual(expired?.allowedActions, ["inspect"]);
    assert.equal((await db("o_agentTrace")).length, 2);
    assert.deepEqual(await write.inspect(7, pending.runId, 1), expired);
    assert.equal((await db("o_assets")).length, 2);
  } finally { await db.destroy(); }
});

test("startup expiry recovery settles a pending approval without Project UI access", async () => {
  const db = await database();
  try {
    const write = runtime(db);
    const pending = await write.propose(proposal);
    await expireDueDerivedAssetApprovals(db, null, 201, () => "recovery-trace");
    assert.equal((await write.inspect(7, pending.runId, 1))?.status, "expired");
    assert.equal((await db("o_agentToolReceipt").first()).status, "failed");
    assert.equal((await db("o_agentTrace")).length, 2);
    await expireDueDerivedAssetApprovals(db, null, 201, () => "unused");
    assert.equal((await db("o_agentTrace")).length, 2);
  } finally { await db.destroy(); }
});
