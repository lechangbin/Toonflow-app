import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from
  "../src/skillRuntime/manifest";
import { assertEqualRuntimeCorpusSkillAuthority,
  inspectRuntimeCorpusSkillBinding } from "../src/eval/runtimeCorpusSkillBinding";

test("T11 fingerprints real active Harness Skills and refuses authority drift", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const oldLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = oldLog; }
    let serial = 0;
    const work = async <T>(operation: (database: typeof db) => Promise<T> | T) => operation(db);
    const skills = createSkillRuntime({ work, now: () => 200,
      createId: () => `t11-skill-${++serial}` });
    const script = await skills.createDefinition({ name: "t11-script", description: "read Script" });
    const production = await skills.createDefinition({ name: "t11-production",
      description: "read Production" });
    const save = async (skillId: string, role: string, version: string,
      content: string, tools: string[], capabilities: string[]) => {
      const manifest: SkillManifest = { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
        skillId, semanticVersion: version, compatibleRoles: [role],
        intents: ["read-only-guidance"], dependencies: [], requestedTools: tools,
        requestedCapabilities: capabilities, resources: [],
        routing: { priority: 1, keywords: [] }, attribution: "T11 binding test" };
      const draft = await skills.saveDraft({ skillId, semanticVersion: version,
        content, manifest });
      await skills.publish({ revisionId: draft.id, expectedContentHash: draft.contentHash });
      return draft;
    };
    const scriptBase = await save(script.id, "scriptAgent", "1.0.0",
      "只读剧本", ["get_script_content"], ["read:script"]);
    const productionBase = await save(production.id, "productionAgent", "1.0.0",
      "只读拍摄计划", ["get_production_workspace_text"], ["read:production-workspace"]);
    await skills.activate({ skillId: script.id, revisionId: scriptBase.id,
      expectedBindingVersion: 0 });
    await skills.activate({ skillId: production.id, revisionId: productionBase.id,
      expectedBindingVersion: 0 });
    const input = { work, scriptSkillId: script.id, productionSkillId: production.id };
    const baseline = await inspectRuntimeCorpusSkillBinding(input);
    assert.match(baseline.revision, /^[a-f0-9]{64}$/u);
    const scriptCandidate = await save(script.id, "scriptAgent", "1.1.0",
      "只读剧本并说明来源", ["get_script_content"], ["read:script"]);
    await skills.activate({ skillId: script.id, revisionId: scriptCandidate.id,
      expectedBindingVersion: 1 });
    const candidate = await inspectRuntimeCorpusSkillBinding(input);
    assert.notEqual(candidate.revision, baseline.revision);
    assertEqualRuntimeCorpusSkillAuthority(baseline, candidate);
    const changedAuthority = await save(script.id, "scriptAgent", "1.2.0",
      "添加章节读取", ["get_script_content", "get_novel_text"], ["read:script", "read:novel"]);
    await skills.activate({ skillId: script.id, revisionId: changedAuthority.id,
      expectedBindingVersion: 2 });
    await assert.rejects(async () => assertEqualRuntimeCorpusSkillAuthority(baseline,
      await inspectRuntimeCorpusSkillBinding(input)), /changed Harness authority/u);
    await assert.rejects(db("o_agentSkillRevision").where({ id: changedAuthority.id })
      .update({ content: "tampered" }), /immutable/u);
    await skills.setRevisionLifecycle({ revisionId: changedAuthority.id,
      expectedVersion: 1, nextState: "revoked" });
    await assert.rejects(inspectRuntimeCorpusSkillBinding(input), /missing or corrupt/u);
  } finally { await db.destroy(); }
});
