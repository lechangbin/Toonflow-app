import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";
import knexFactory, { Knex } from "knex";

import { createCheckVideoPromptRouter } from "../src/routes/production/workbench/checkVideoPromptRouter";
import { readVideoPromptStatuses } from "../src/video/promptStatus";

async function createPromptStatusDatabase(): Promise<Knex> {
  const db = knexFactory({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });
  await db.schema.createTable("o_videoTrack", (table) => {
    table.integer("id").primary();
    table.integer("projectId");
    table.integer("scriptId");
    table.string("state");
    table.string("reason");
    table.integer("promptRevisionId");
  });
  await db.schema.createTable("o_promptRevision", (table) => {
    table.integer("id").primary();
    table.integer("projectId").notNullable();
    table.integer("videoTrackId").notNullable();
    table.text("renderedPrompt").notNullable();
  });
  return db;
}

test("completed Video Track returns its immutable Prompt Revision without a legacy prompt column", async () => {
  const db = await createPromptStatusDatabase();
  try {
    await db("o_videoTrack").insert({
      id: 7,
      projectId: 1,
      scriptId: 2,
      state: "已完成",
      reason: null,
      promptRevisionId: 11,
    });
    await db("o_promptRevision").insert({
      id: 11,
      projectId: 1,
      videoTrackId: 7,
      renderedPrompt: "A deliberate camera move",
    });

    const statuses = await readVideoPromptStatuses(db, {
      projectId: 1,
      scriptId: 2,
      trackIds: [7],
    });

    assert.deepEqual(statuses, [
      {
        id: 7,
        state: "已完成",
        reason: null,
        prompt: "A deliberate camera move",
      },
    ]);
  } finally {
    await db.destroy();
  }
});

test("prompt polling HTTP route returns the completed Track prompt projection", async () => {
  const db = await createPromptStatusDatabase();
  await db("o_videoTrack").insert({
    id: 8,
    projectId: 3,
    scriptId: 4,
    state: "已完成",
    reason: null,
    promptRevisionId: 12,
  });
  await db("o_promptRevision").insert({
    id: 12,
    projectId: 3,
    videoTrackId: 8,
    renderedPrompt: "Keep the subject stable",
  });

  const app = express();
  app.use(express.json());
  app.use(createCheckVideoPromptRouter(db));
  app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(500).json({ message: error.message });
  });
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: 3, scriptId: 4, trackIds: [8] }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      code: 200,
      data: [{ id: 8, state: "已完成", reason: null, prompt: "Keep the subject stable" }],
      message: "成功",
    });
  } finally {
    server.close();
    await once(server, "close");
    await db.destroy();
  }
});

test("completed Video Track without a Prompt Revision fails explicitly", async () => {
  const db = await createPromptStatusDatabase();
  try {
    await db("o_videoTrack").insert({
      id: 9,
      projectId: 3,
      scriptId: 4,
      state: "已完成",
      reason: null,
      promptRevisionId: null,
    });

    await assert.rejects(
      readVideoPromptStatuses(db, { projectId: 3, scriptId: 4, trackIds: [9] }),
      /Video Track 9 已完成但没有 Prompt Revision/,
    );
  } finally {
    await db.destroy();
  }
});

test("completed Video Track rejects a Prompt Revision owned by another Project or Track", async () => {
  const db = await createPromptStatusDatabase();
  try {
    await db("o_videoTrack").insert([
      { id: 10, projectId: 3, scriptId: 4, state: "已完成", reason: null, promptRevisionId: 13 },
      { id: 11, projectId: 3, scriptId: 4, state: "已完成", reason: null, promptRevisionId: 14 },
    ]);
    await db("o_promptRevision").insert([
      { id: 13, projectId: 99, videoTrackId: 10, renderedPrompt: "foreign project prompt" },
      { id: 14, projectId: 3, videoTrackId: 99, renderedPrompt: "foreign track prompt" },
    ]);

    await assert.rejects(
      readVideoPromptStatuses(db, { projectId: 3, scriptId: 4, trackIds: [10] }),
      /Prompt Revision 13 不属于 Project 3 \/ Video Track 10/,
    );
    await assert.rejects(
      readVideoPromptStatuses(db, { projectId: 3, scriptId: 4, trackIds: [11] }),
      /Prompt Revision 14 不属于 Project 3 \/ Video Track 11/,
    );
  } finally {
    await db.destroy();
  }
});

test("failed Video Track returns its reason and an empty prompt without a Prompt Revision", async () => {
  const db = await createPromptStatusDatabase();
  try {
    await db("o_videoTrack").insert({
      id: 12,
      projectId: 3,
      scriptId: 4,
      state: "生成失败",
      reason: "provider rejected the prompt",
      promptRevisionId: null,
    });

    assert.deepEqual(await readVideoPromptStatuses(db, { projectId: 3, scriptId: 4, trackIds: [12] }), [
      {
        id: 12,
        state: "生成失败",
        reason: "provider rejected the prompt",
        prompt: "",
      },
    ]);
  } finally {
    await db.destroy();
  }
});

test("empty Track IDs return an empty prompt status list", async () => {
  const db = await createPromptStatusDatabase();
  try {
    assert.deepEqual(await readVideoPromptStatuses(db, { projectId: 3, scriptId: 4, trackIds: [] }), []);
  } finally {
    await db.destroy();
  }
});

test("prompt polling omits Tracks outside the requested Project, Script, or terminal states", async () => {
  const db = await createPromptStatusDatabase();
  try {
    await db("o_videoTrack").insert([
      { id: 13, projectId: 3, scriptId: 4, state: "已完成", reason: null, promptRevisionId: 15 },
      { id: 14, projectId: 99, scriptId: 4, state: "已完成", reason: null, promptRevisionId: 16 },
      { id: 15, projectId: 3, scriptId: 99, state: "已完成", reason: null, promptRevisionId: 17 },
      { id: 16, projectId: 3, scriptId: 4, state: "生成中", reason: null, promptRevisionId: null },
    ]);
    await db("o_promptRevision").insert([
      { id: 15, projectId: 3, videoTrackId: 13, renderedPrompt: "requested prompt" },
      { id: 16, projectId: 99, videoTrackId: 14, renderedPrompt: "other project" },
      { id: 17, projectId: 3, videoTrackId: 15, renderedPrompt: "other script" },
    ]);

    assert.deepEqual(
      await readVideoPromptStatuses(db, { projectId: 3, scriptId: 4, trackIds: [13, 14, 15, 16] }),
      [{ id: 13, state: "已完成", reason: null, prompt: "requested prompt" }],
    );
  } finally {
    await db.destroy();
  }
});
