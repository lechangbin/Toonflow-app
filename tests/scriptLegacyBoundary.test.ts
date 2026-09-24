import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { readLegacyScriptContents } from "../src/agents/scriptAgent/tools";
import { authorizeLegacyScriptSocket } from "../src/socket/routes/scriptAgent";

test("legacy Script Socket binds actor, Project, and Memory key", async () => {
  const projectOwned = async (projectId: number, actorUserId: number) =>
    projectId === 7 && actorUserId === 1;
  assert.equal(await authorizeLegacyScriptSocket({ actorUserId: 1, projectId: 7,
    isolationKey: "7:scriptAgent" }, projectOwned), true);
  assert.equal(await authorizeLegacyScriptSocket({ actorUserId: 1, projectId: "7",
    isolationKey: "7:scriptAgent" }, projectOwned), true,
  "the existing Web Socket passes the Project ID as a decimal string");
  for (const input of [
    { actorUserId: null, projectId: 7, isolationKey: "7:scriptAgent" },
    { actorUserId: 2, projectId: 7, isolationKey: "7:scriptAgent" },
    { actorUserId: 1, projectId: 9, isolationKey: "9:scriptAgent" },
    { actorUserId: 1, projectId: 7, isolationKey: "9:scriptAgent" },
    { actorUserId: 1, projectId: "07", isolationKey: "7:scriptAgent" },
    { actorUserId: 1, projectId: "7x", isolationKey: "7:scriptAgent" },
  ]) {
    assert.equal(await authorizeLegacyScriptSocket(input, projectOwned), false);
  }
});

test("legacy Script content read ignores IDs from another Project", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.schema.createTable("o_script", (table) => {
      table.increments("id").primary();
      table.integer("projectId").notNullable();
      table.text("name").notNullable();
      table.text("content").notNullable();
    });
    await db("o_script").insert([
      { id: 1, projectId: 7, name: "本项目", content: "allowed" },
      { id: 2, projectId: 9, name: "其他项目", content: "secret" },
    ]);
    assert.deepEqual(await readLegacyScriptContents(db, 7, ["1", "2"]),
      [{ name: "本项目", content: "allowed" }]);
  } finally { await db.destroy(); }
});
