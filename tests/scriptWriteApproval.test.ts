import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import initDB from "../src/lib/initDB";
import {
  createScriptWriteApprovalRuntime,
} from "../src/controlledTools/scriptWriteApproval";

test("Script write proposal freezes exact target and approval without mutating Project data", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert([{ id: 7, userId: 1, name: "本项目" },
      { id: 9, userId: 2, name: "其他项目" }]);
    await db("o_agentWorkData").insert({ id: 11, projectId: 7,
      key: "scriptAgent", data: JSON.stringify({ storySkeleton: "旧骨架",
        adaptationStrategy: "旧策略" }) });
    await db("o_script").insert([{ id: 21, projectId: 7,
      name: "第一集", content: "旧剧本" },
    { id: 22, projectId: 9, name: "其他剧本", content: "私有剧本" }]);
    let serial = 0;
    const runtime = createScriptWriteApprovalRuntime({
      work: async (operation) => operation(db), now: () => 100,
      createId: () => `script-write-${++serial}`,
    });
    const input = { projectId: 7, actorUserId: 1,
      clientRequestId: "workspace-write-1", operationId: "operation-1",
      kind: "workspace" as const,
      payload: { key: "storySkeleton", content: "新骨架" } };
    await assert.rejects(runtime.propose({ ...input, actorUserId: 2 }), /scope/);
    assert.equal((await db("o_agentRun")).length, 0);
    const proposed = await runtime.propose(input);
    assert.equal(proposed.status, "pending");
    assert.equal(proposed.runStatus, "waiting");
    assert.equal(proposed.runVersion, 1);
    assert.equal(JSON.stringify(proposed.preview).includes("新骨架"), false);
    assert.equal((await db("o_agentWorkData").where("id", 11).first()).data,
      JSON.stringify({ storySkeleton: "旧骨架", adaptationStrategy: "旧策略" }));
    assert.equal((await db("o_agentToolReceipt").where({ runId: proposed.runId }).first()).status,
      "pending");
    assert.equal((await db("o_agentRunCheckpoint").where({ runId: proposed.runId })).length, 1);
    assert.equal((await db("o_agentTrace").where({ runId: proposed.runId }).first()).eventType,
      "tool.approval.requested");
    assert.deepEqual(await runtime.propose(input), proposed);
    assert.equal((await db("o_agentRun")).length, 1);
    await assert.rejects(runtime.propose({ ...input,
      payload: { key: "storySkeleton", content: "偷偷更换" } }), /identity conflicts/);
    assert.equal(await runtime.inspect(7, proposed.runId, 2).catch(() => null), null);
    assert.deepEqual(await runtime.inspect(7, proposed.runId, 1), proposed);
    const workspaceDecision = { projectId: 7, actorUserId: 1,
      runId: proposed.runId, approvalId: proposed.id,
      clientCommandId: "approve-workspace-1", expectedVersion: 1,
      decision: "approve" as const };
    await assert.rejects(runtime.decide({ ...workspaceDecision,
      actorUserId: 2 }), /scope/);
    assert.equal((await db("o_agentWorkData").where("id", 11).first()).data,
      JSON.stringify({ storySkeleton: "旧骨架", adaptationStrategy: "旧策略" }));
    const approved = await runtime.decide(workspaceDecision);
    assert.equal(approved?.status, "approved");
    assert.equal(approved?.runStatus, "succeeded");
    assert.equal(approved?.runVersion, 2);
    assert.deepEqual(JSON.parse((await db("o_agentWorkData").where("id", 11).first()).data),
      { storySkeleton: "新骨架", adaptationStrategy: "旧策略" });
    assert.deepEqual(await runtime.decide(workspaceDecision), approved);
    assert.equal((await db("o_agentRunOutput").where({ runId: proposed.runId })).length, 1);
    assert.equal((await db("o_agentRunCheckpoint").where({ runId: proposed.runId })).length, 2);
    await assert.rejects(runtime.decide({ ...workspaceDecision,
      clientCommandId: "approve-workspace-twice" }), /identity conflicts/);
    await assert.rejects(runtime.propose({ projectId: 7, actorUserId: 1,
      clientRequestId: "foreign-script", operationId: "operation-2",
      kind: "script", payload: { effect: "update", scriptId: 22,
        name: "其他剧本", content: "越权" } }), /missing-script/);
    const scriptProposal = await runtime.propose({ projectId: 7, actorUserId: 1,
      clientRequestId: "script-write-1", operationId: "operation-3",
      kind: "script", payload: { effect: "update", scriptId: 21,
        name: "第一集", content: "新剧本" } });
    assert.equal(scriptProposal.status, "pending");
    assert.equal(scriptProposal.kind, "script");
    assert.equal(JSON.stringify(scriptProposal.preview).includes("新剧本"), false);
    await db("o_script").where("id", 21).update({ content: "旧入口在审批前改动" });
    const conflicted = await runtime.decide({ projectId: 7, actorUserId: 1,
      runId: scriptProposal.runId, approvalId: scriptProposal.id,
      clientCommandId: "approve-stale-script", expectedVersion: 1,
      decision: "approve" });
    assert.equal(conflicted?.status, "conflicted");
    assert.equal(conflicted?.runStatus, "waiting");
    assert.equal((await db("o_script").where("id", 21).first()).content,
      "旧入口在审批前改动");
    await assert.rejects(runtime.propose({ projectId: 7, actorUserId: 1,
      clientRequestId: "script-create-duplicate", operationId: "operation-4",
      kind: "script", payload: { effect: "create",
        name: "第一集", content: "重复" } }), /duplicate-name/);
    const createdProposal = await runtime.propose({ projectId: 7, actorUserId: 1,
      clientRequestId: "script-create-1", operationId: "operation-5",
      kind: "script", payload: { effect: "create", name: "第二集",
        content: "新建剧本" } });
    const created = await runtime.decide({ projectId: 7, actorUserId: 1,
      runId: createdProposal.runId, approvalId: createdProposal.id,
      clientCommandId: "approve-create-script", expectedVersion: 1,
      decision: "approve" });
    assert.equal(created?.status, "approved");
    assert.equal((await db("o_script").where({ projectId: 7,
      name: "第二集" }).first()).content, "新建剧本");
  } finally { await db.destroy(); }
});

test("Script write rejection, expiry, and commit failure leave Project data unchanged", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert({ id: 7, userId: 1, name: "本项目" });
    await db("o_agentWorkData").insert({ id: 11, projectId: 7,
      key: "scriptAgent", data: JSON.stringify({ storySkeleton: "旧骨架" }) });
    let serial = 0;
    let now = 100;
    const runtime = createScriptWriteApprovalRuntime({
      work: async (operation) => operation(db), now: () => now,
      createId: () => `script-decision-${++serial}`, approvalTtlMs: 100,
    });
    const propose = (suffix: string) => runtime.propose({ projectId: 7,
      actorUserId: 1, clientRequestId: `request-${suffix}`,
      operationId: `operation-${suffix}`, kind: "workspace",
      payload: { key: "storySkeleton", content: `新骨架-${suffix}` } });
    const rejection = await propose("reject");
    const rejected = await runtime.decide({ projectId: 7, actorUserId: 1,
      runId: rejection.runId, approvalId: rejection.id,
      clientCommandId: "reject-1", expectedVersion: 1,
      decision: "reject" });
    assert.equal(rejected?.status, "rejected");
    assert.equal(rejected?.runStatus, "cancelled");
    const expiry = await propose("expire");
    now = 200;
    const expired = await runtime.decide({ projectId: 7, actorUserId: 1,
      runId: expiry.runId, approvalId: expiry.id,
      clientCommandId: "approve-expired", expectedVersion: 1,
      decision: "approve" });
    assert.equal(expired?.status, "expired");
    assert.equal(expired?.runStatus, "waiting");
    now = 210;
    const rollback = await propose("rollback");
    await db.raw(`CREATE TRIGGER reject_script_output BEFORE INSERT ON o_agentRunOutput
      BEGIN SELECT RAISE(ABORT, 'injected-output-failure'); END`);
    await assert.rejects(runtime.decide({ projectId: 7, actorUserId: 1,
      runId: rollback.runId, approvalId: rollback.id,
      clientCommandId: "approve-rollback", expectedVersion: 1,
      decision: "approve" }), /injected-output-failure/);
    assert.equal((await db("o_agentWorkData").where("id", 11).first()).data,
      JSON.stringify({ storySkeleton: "旧骨架" }));
    assert.equal((await db("o_agentToolApproval").where("id", rollback.id).first()).status,
      "pending");
    assert.equal((await db("o_agentToolReceipt").where({ runId: rollback.runId }).first()).status,
      "pending");
  } finally { await db.destroy(); }
});
