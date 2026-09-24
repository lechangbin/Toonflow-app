import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";
import knexFactory from "knex";

import initDB from "../src/lib/initDB";
import { createSkillManagementRouter } from "../src/routes/agentSkills/manage";
import { createSkillRuntime } from "../src/skillRuntime";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from
  "../src/skillRuntime/manifest";

test("Admin projection validates, publishes, activates, and inspects immutable Skills", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    let serial = 0;
    const runtime = createSkillRuntime({ work: async (operation) => operation(db),
      now: () => 100, createId: () => `skill-admin-${++serial}` });
    const definition = await runtime.createDefinition({
      name: "script-guidance", description: "Script Harness 专用 Skill" });
    const manifest: SkillManifest = { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
      skillId: definition.id, semanticVersion: "1.0.0",
      compatibleRoles: ["scriptAgent"], intents: ["read-only-guidance"],
      dependencies: [], requestedTools: ["get_novel_text"],
      requestedCapabilities: ["read:novel"], resources: [],
      routing: { priority: 1, keywords: [] }, attribution: "管理员定向测试" };
    assert.equal(runtime.validateDraft({ skillId: definition.id,
      semanticVersion: "1.0.0", content: "读取小说", manifest }).skillId, definition.id);
    assert.equal((await db("o_agentSkillRevision")).length, 0,
      "validation is read-only");
    const draft = await runtime.saveDraft({ skillId: definition.id,
      semanticVersion: "1.0.0", content: "读取小说", manifest });
    const listing = await runtime.listForAdministration();
    assert.equal(listing[0].revisions[0].id, draft.id);
    assert.equal(JSON.stringify(listing).includes("读取小说"), false,
      "list is content-free");
    assert.equal((await runtime.inspectRevisionForAdministration(draft.id))?.content,
      "读取小说");
    await runtime.publish({ revisionId: draft.id,
      expectedContentHash: draft.contentHash });
    await runtime.activate({ skillId: definition.id, revisionId: draft.id,
      expectedBindingVersion: 0 });
    assert.equal((await runtime.listForAdministration())[0]
      .binding?.activeRevisionId, draft.id);
    await assert.rejects(runtime.updateDraft({ revisionId: draft.id,
      expectedContentHash: draft.contentHash, content: "篡改", manifest }), /no longer editable/);
  } finally { await db.destroy(); }
});

test("Skill management transport rejects non-admin actors and never trusts body actor", async () => {
  const calls: unknown[] = [];
  const runtime = { listForAdministration: async () => {
    calls.push("list"); return [];
  }, createDefinition: async (input: unknown) => {
    calls.push(input); return { id: "skill-1" };
  } } as unknown as ReturnType<typeof createSkillRuntime>;
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = {
      id: Number(req.headers["x-test-actor"]),
    };
    next();
  }, createSkillManagementRouter({ runtime,
    isAdmin: async (actor) => actor === 1 }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const post = (actor: number, body: unknown) => fetch(
      `http://127.0.0.1:${address.port}/`, { method: "POST",
        headers: { "content-type": "application/json",
          "x-test-actor": String(actor) }, body: JSON.stringify(body) });
    assert.equal((await post(2, { action: "create", name: "evil",
      description: "bad", actorUserId: 1 })).status, 403);
    assert.equal(calls.length, 0);
    assert.equal((await post(1, { action: "create", name: "good",
      description: "safe", actorUserId: 2 })).status, 400,
    "strict command rejects a forged actor field");
    const valid = await post(1, { action: "create", name: "good",
      description: "safe" });
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get("cache-control"), "no-store");
    assert.deepEqual(calls, [{ name: "good", description: "safe" }]);
  } finally { server.close(); await once(server, "close"); }
});
