import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime } from "../src/agentRuntime";
import { deleteProjectAgentEvidence } from "../src/agentRuntime/retention";
import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from "../src/skillRuntime/manifest";

const manifest = (skillId: string, semanticVersion: string): SkillManifest => ({
  schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION, skillId, semanticVersion,
  compatibleRoles: ["scriptAgent"], intents: ["read-only-guidance"], dependencies: [],
  requestedTools: ["get_novel_text"], requestedCapabilities: ["read:novel"], resources: [],
  routing: { priority: 10, keywords: ["章节"] }, attribution: "本项目只读指导",
});

test("draft, publish, activate, Run bind and rollback preserve immutable Skill revisions", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert({ id: 7, userId: 1, name: "本项目" });
    let serial = 0;
    const skills = createSkillRuntime({ work: async (operation) => operation(db),
      now: () => 100 + serial, createId: () => `skill-${++serial}` });
    const definition = await skills.createDefinition({ name: "novel-guidance", description: "只读章节指导" });
    await assert.rejects(skills.saveDraft({ skillId: definition.id, semanticVersion: "1.0.0",
      content: "第一版", manifest: { ...manifest(definition.id, "1.0.0"), skillId: "other" } }),
    /identity differs/);
    await assert.rejects(skills.saveDraft({ skillId: definition.id, semanticVersion: "1.0.0",
      content: "第一版", manifest: { ...manifest(definition.id, "1.0.0"),
        requestedTools: ["get_novel_text", "get_novel_text"] } }), /duplicate identities/);
    const draft1 = await skills.saveDraft({ skillId: definition.id, semanticVersion: "1.0.0",
      content: "第一版", manifest: manifest(definition.id, "1.0.0") });
    const updated = await skills.updateDraft({ revisionId: draft1.id,
      expectedContentHash: draft1.contentHash, content: "第一版修订",
      manifest: manifest(definition.id, "1.0.0") });
    await assert.rejects(skills.publish({ revisionId: draft1.id,
      expectedContentHash: draft1.contentHash }), /changed before publish/);
    const published1 = await skills.publish({ revisionId: draft1.id,
      expectedContentHash: updated.contentHash });
    assert.equal(published1.status, "published");
    await assert.rejects(db("o_agentSkillRevision").where({ id: draft1.id })
      .update({ content: "篡改" }), /immutable/);
    await assert.rejects(db("o_agentSkillRevision").where({ id: draft1.id }).delete(), /durable evidence/);
    await skills.activate({ skillId: definition.id, revisionId: draft1.id, expectedBindingVersion: 0 });
    const runtime = createAgentRuntime({ work: async (operation) => operation(db),
      now: () => 200 + serial, createId: () => `run-${++serial}`,
      schedule: () => undefined, openTextCall: async () => { throw new Error("not executing Model"); } });
    const start = async (clientRequestId: string) => runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId, content: "根据章节指导" });
    const firstRun = await start("first-skill-run");
    const firstBinding = await skills.bindRun({ runId: firstRun.id, projectId: 7,
      skillIds: [definition.id] });
    assert.equal(firstBinding[0].revisionId, draft1.id);
    const draft2 = await skills.saveDraft({ skillId: definition.id, semanticVersion: "1.1.0",
      content: "第二版", manifest: manifest(definition.id, "1.1.0") });
    await skills.publish({ revisionId: draft2.id, expectedContentHash: draft2.contentHash });
    await skills.activate({ skillId: definition.id, revisionId: draft2.id, expectedBindingVersion: 1 });
    await assert.rejects(skills.activate({ skillId: definition.id,
      revisionId: draft1.id, expectedBindingVersion: 1 }), /version conflict/);
    assert.deepEqual(await skills.bindRun({ runId: firstRun.id, projectId: 7,
      skillIds: [definition.id] }), firstBinding,
    "later activation must not rewrite a queued Run's frozen Skill Revision");
    const secondRun = await start("second-skill-run");
    assert.equal((await skills.bindRun({ runId: secondRun.id, projectId: 7,
      skillIds: [definition.id] }))[0].revisionId, draft2.id);
    await skills.activate({ skillId: definition.id, revisionId: draft1.id, expectedBindingVersion: 2 });
    const thirdRun = await start("third-skill-run");
    assert.equal((await skills.bindRun({ runId: thirdRun.id, projectId: 7,
      skillIds: [definition.id] }))[0].revisionId, draft1.id,
    "rollback changes only future Run binding");
    const incompatible = await skills.createDefinition({ name: "production-only", description: "生产专用" });
    const productionDraft = await skills.saveDraft({ skillId: incompatible.id, semanticVersion: "1.0.0",
      content: "生产角色限定指令", manifest: { ...manifest(incompatible.id, "1.0.0"),
        compatibleRoles: ["productionAgent"] } });
    await skills.publish({ revisionId: productionDraft.id,
      expectedContentHash: productionDraft.contentHash });
    await skills.activate({ skillId: incompatible.id, revisionId: productionDraft.id,
      expectedBindingVersion: 0 });
    const fourthRun = await start("fourth-skill-run");
    await assert.rejects(skills.bindRun({ runId: fourthRun.id, projectId: 7,
      skillIds: [incompatible.id] }), /role is incompatible/);
    assert.equal((await db("o_agentRunSkillBinding").where({ runId: fourthRun.id })).length, 0);
    await assert.rejects(skills.bindRun({ runId: thirdRun.id, projectId: 9,
      skillIds: [definition.id] }), /not queued in Project scope/);
    await assert.rejects(db("o_agentRunSkillBinding").where({ runId: firstRun.id }).delete(),
      /durable evidence/);
    await db.transaction(async (tx) => {
      await tx("o_project").where({ id: 7 }).delete();
      await deleteProjectAgentEvidence(tx, 7);
    });
    assert.equal((await db("o_agentRunSkillBinding")).length, 0);
  } finally { await db.destroy(); }
});

test("Skill schema upgrade preserves legacy editable Skill rows without silently publishing them", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert({ id: 7, userId: 1, name: "旧项目" });
    await db("o_skillList").insert({ id: "legacy-editable" });
    await db.schema.dropTable("o_agentRunSkillBinding");
    await db.schema.dropTable("o_agentSkillBinding");
    await db.schema.dropTable("o_agentSkillRevision");
    await db.schema.dropTable("o_agentSkillDefinition");
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    assert.equal(await db.schema.hasTable("o_agentSkillRevision"), true);
    assert.equal((await db("o_skillList").where({ id: "legacy-editable" }).first()).id, "legacy-editable");
    assert.equal((await db("o_project").where({ id: 7 }).first()).name, "旧项目");
    assert.equal((await db("o_agentSkillRevision")).length, 0,
      "an editable legacy file must not be treated as a published revision");
  } finally { await db.destroy(); }
});
