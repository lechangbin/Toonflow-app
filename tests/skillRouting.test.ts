import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from "../src/skillRuntime/manifest";
import { createSkillRouter } from "../src/skillRuntime/routing";

test("Skill routing filters role/intent before ranking and pauses on an exact top tie", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    let serial = 0;
    const skills = createSkillRuntime({ work: async (operation) => operation(db),
      now: () => 100 + serial, createId: () => `routing-${++serial}` });
    const add = async (name: string, role: string, intent: string, priority: number,
      keywords: string[]) => {
      const definition = await skills.createDefinition({ name, description: name });
      const manifest: SkillManifest = { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
        skillId: definition.id, semanticVersion: "1.0.0", compatibleRoles: [role],
        intents: [intent], dependencies: [], requestedTools: [], requestedCapabilities: [],
        resources: [], routing: { priority, keywords }, attribution: "路由测试" };
      const draft = await skills.saveDraft({ skillId: definition.id, semanticVersion: "1.0.0",
        content: `Instruction ${name}`, manifest });
      await skills.publish({ revisionId: draft.id, expectedContentHash: draft.contentHash });
      await skills.activate({ skillId: definition.id, revisionId: draft.id, expectedBindingVersion: 0 });
      return { skillId: definition.id, revisionId: draft.id };
    };
    const first = await add("script-first", "scriptAgent", "chapter-guidance", 10, ["章节"]);
    const second = await add("script-second", "scriptAgent", "chapter-guidance", 10, ["章节"]);
    await add("wrong-role", "productionAgent", "chapter-guidance", 100, ["章节"]);
    await add("wrong-intent", "scriptAgent", "asset-generation", 100, ["章节"]);
    const router = createSkillRouter(async (operation) => operation(db));
    const tied = await router.route({ role: "scriptAgent", intent: "chapter-guidance",
      query: "请分析章节" });
    assert.equal(tied.status, "needs-attention");
    assert.equal(tied.selected, null);
    assert.deepEqual(tied.candidates.filter((candidate) => !candidate.eligible)
      .map((candidate) => candidate.reason).sort(), ["intent", "role"]);
    await db("o_agentSkillBinding").where({ skillId: second.skillId }).delete();
    const selected = await router.route({ role: "scriptAgent", intent: "chapter-guidance",
      query: "请分析章节" });
    assert.equal(selected.status, "selected");
    assert.deepEqual(selected.selected, first);
    const unavailable = await router.route({ role: "scriptAgent", intent: "storyboard",
      query: "章节" });
    assert.equal(unavailable.status, "unavailable");
  } finally { await db.destroy(); }
});
