import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import {
  scriptContentTargetState, scriptWorkspaceTargetState,
} from "../src/controlledTools/scriptWriteState";

test("Script workspace target hash detects legacy mutation and ambiguous rows", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.schema.createTable("o_project", (table) => table.integer("id").primary());
    await db.schema.createTable("o_agentWorkData", (table) => {
      table.integer("id").primary(); table.integer("projectId"); table.text("key");
      table.text("data"); table.integer("createTime"); table.integer("updateTime");
    });
    await db("o_project").insert([{ id: 7 }, { id: 9 }]);
    const payload = { key: "storySkeleton" as const, content: "新故事" };
    const empty = await scriptWorkspaceTargetState(db, 7, payload);
    assert.equal(empty.rowId, null);
    await db("o_agentWorkData").insert({ id: 1, projectId: 7,
      key: "scriptAgent", data: JSON.stringify({ storySkeleton: "旧故事" }) });
    const before = await scriptWorkspaceTargetState(db, 7, payload);
    assert.notEqual(empty.stateHash, before.stateHash);
    await db("o_agentWorkData").where("id", 1).update({
      data: JSON.stringify({ storySkeleton: "旧入口改过" }) });
    assert.notEqual((await scriptWorkspaceTargetState(db, 7, payload)).stateHash,
      before.stateHash);
    assert.equal((await scriptWorkspaceTargetState(db, 9, payload)).rowId, null);
    await db("o_agentWorkData").insert({ id: 2, projectId: 7,
      key: "scriptAgent", data: "{}" });
    await assert.rejects(scriptWorkspaceTargetState(db, 7, payload), /ambiguous-workspace/);
  } finally { await db.destroy(); }
});

test("Script target state is Project-scoped and detects edits and same-name creates", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.schema.createTable("o_project", (table) => table.integer("id").primary());
    await db.schema.createTable("o_script", (table) => {
      table.integer("id").primary(); table.integer("projectId"); table.text("name");
      table.text("content"); table.integer("extractState");
      table.text("errorReason"); table.integer("createTime");
    });
    await db("o_project").insert([{ id: 7 }, { id: 9 }]);
    const create = { effect: "create" as const, name: "第一集", content: "待写内容" };
    const absent = await scriptContentTargetState(db, 7, create);
    assert.equal(absent.scriptId, null);
    await db("o_script").insert([{ id: 1, projectId: 7,
      name: "第一集", content: "已有内容" },
    { id: 2, projectId: 9, name: "外部剧本", content: "外部内容" }]);
    await assert.rejects(scriptContentTargetState(db, 7, create), /duplicate-name/);
    await assert.rejects(scriptContentTargetState(db, 7,
      { effect: "update", scriptId: 2, name: "外部剧本", content: "越权" }), /missing-script/);
    const update = { effect: "update" as const, scriptId: 1,
      name: "第一集", content: "新内容" };
    const before = await scriptContentTargetState(db, 7, update);
    await db("o_script").where("id", 1).update({ content: "旧入口改过" });
    assert.notEqual((await scriptContentTargetState(db, 7, update)).stateHash,
      before.stateHash);
    await db("o_script").insert({ id: 3, projectId: 7,
      name: "重名", content: "" });
    await assert.rejects(scriptContentTargetState(db, 7,
      { ...update, name: "重名" }), /duplicate-name/);
  } finally { await db.destroy(); }
});
