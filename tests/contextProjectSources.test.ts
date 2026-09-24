import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createProjectContextSourceLoader } from "../src/context/projectSources";

test("Project Context loader derives ownership from SQLite and never reads a foreign Novel", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.schema.createTable("o_project", (table) => {
      table.integer("id").primary(); table.text("name"); table.text("type"); table.text("intro");
      table.text("artStyle"); table.text("videoRatio");
    });
    await db.schema.createTable("o_novel", (table) => {
      table.integer("id").primary(); table.integer("projectId"); table.integer("chapterIndex");
      table.text("chapter"); table.text("chapterData");
    });
    await db("o_project").insert([{ id: 7, name: "本项目" }, { id: 9, name: "另一个项目" }]);
    await db("o_novel").insert([{ id: 2, projectId: 7, chapterIndex: 1, chapter: "序章", chapterData: "本项目原文" },
      { id: 3, projectId: 9, chapterIndex: 1, chapter: "隐私", chapterData: "绝不能泄露" }]);
    const loader = createProjectContextSourceLoader(async (operation) => operation(db));
    const first = await loader.load({ projectId: 7, novelIds: [3, 2] });
    assert.deepEqual(first.map((entry) => entry.id), ["project:7", "novel:2"]);
    assert.equal(first.some((entry) => entry.content.includes("绝不能泄露")), false);
    const second = await loader.load({ projectId: 7, novelIds: [2] });
    assert.deepEqual(first, second, "foreign IDs cannot affect the authorized source revision");
    await assert.rejects(loader.load({ projectId: 8, novelIds: [] }), /missing/);
    await assert.rejects(loader.load({ projectId: 7, novelIds: [2, 2] }), /invalid/);
  } finally { await db.destroy(); }
});

test("Project Context loader rejects unsafe text before producing a source", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.schema.createTable("o_project", (table) => {
      table.integer("id").primary(); table.text("name"); table.text("type"); table.text("intro");
      table.text("artStyle"); table.text("videoRatio");
    });
    await db.schema.createTable("o_novel", (table) => {
      table.integer("id").primary(); table.integer("projectId"); table.integer("chapterIndex");
    });
    await db("o_project").insert({ id: 7, intro: "api_key=not-for-model" });
    const loader = createProjectContextSourceLoader(async (operation) => operation(db));
    await assert.rejects(loader.load({ projectId: 7, novelIds: [] }), /unsafe persisted text/);
  } finally { await db.destroy(); }
});
