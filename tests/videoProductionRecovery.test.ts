import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { failInterruptedVideoProduction } from "../src/video/recovery";

test("startup recovery fails every interrupted Video production record consistently", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_productionAction", (table) => {
    table.integer("id").primary();
    table.string("status");
    table.integer("completedAt");
  });
  await db.schema.createTable("o_generationTask", (table) => {
    table.integer("id").primary();
    table.integer("actionId");
    table.string("status");
    table.integer("completedAt");
    table.text("error");
  });
  await db.schema.createTable("o_videoTrack", (table) => {
    table.integer("id").primary();
    table.string("state");
    table.text("reason");
  });
  await db.schema.createTable("o_artifactRevision", (table) => {
    table.integer("id").primary();
    table.integer("actionId");
    table.integer("generationTaskId");
    table.string("status");
  });
  await db.schema.createTable("o_video", (table) => {
    table.integer("id").primary();
    table.string("state");
    table.text("errorReason");
  });
  await db("o_productionAction").insert([{ id: 1, status: "running" }, { id: 2, status: "succeeded" }]);
  await db("o_generationTask").insert([
    { id: 3, actionId: 1, status: "running" },
    { id: 4, actionId: 2, status: "succeeded" },
  ]);
  await db("o_videoTrack").insert([{ id: 5, state: "生成中" }, { id: 6, state: "已完成" }]);
  await db("o_artifactRevision").insert([
    { id: 7, actionId: 1, generationTaskId: 3, status: "draft" },
    { id: 8, actionId: 2, generationTaskId: 4, status: "accepted" },
    { id: 11, actionId: 2, generationTaskId: 4, status: "draft" },
    { id: 12, actionId: 1, generationTaskId: 4, status: "draft" },
  ]);
  await db("o_video").insert([{ id: 9, state: "生成中" }, { id: 10, state: "生成成功" }]);

  try {
    await failInterruptedVideoProduction(db, 1234);
    assert.deepEqual(await db("o_productionAction").where("id", 1).first(), { id: 1, status: "failed", completedAt: 1234 });
    assert.deepEqual(await db("o_generationTask").where("id", 3).first(), {
      id: 3,
      actionId: 1,
      status: "failed",
      completedAt: 1234,
      error: "软件退出导致失败",
    });
    assert.deepEqual(await db("o_videoTrack").where("id", 5).first(), {
      id: 5,
      state: "生成失败",
      reason: "软件退出导致失败",
    });
    assert.equal((await db("o_artifactRevision").where("id", 7).first()).status, "rejected");
    assert.equal((await db("o_artifactRevision").where("id", 12).first()).status, "rejected");
    assert.equal((await db("o_artifactRevision").where("id", 11).first()).status, "draft");
    assert.deepEqual(await db("o_video").where("id", 9).first(), {
      id: 9,
      state: "生成失败",
      errorReason: "软件退出导致失败",
    });
    assert.equal((await db("o_productionAction").where("id", 2).first()).status, "succeeded");
    assert.equal((await db("o_artifactRevision").where("id", 8).first()).status, "accepted");
  } finally {
    await db.destroy();
  }
});
