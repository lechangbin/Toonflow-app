import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime } from "../src/agentRuntime";
import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from "../src/skillRuntime/manifest";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("a Run reads only declared, hash-verified ResourceRevision IDs, never a mutable path", async () => {
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
      now: () => 100 + serial, createId: () => `resource-${++serial}` });
    const definition = await skills.createDefinition({ name: "resource-skill", description: "有资源的技能" });
    const resourceContent = "# 有界指导\n只读章节。";
    const manifest: SkillManifest = { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
      skillId: definition.id, semanticVersion: "1.0.0", compatibleRoles: ["scriptAgent"],
      intents: ["read-only-guidance"], dependencies: [], requestedTools: [],
      requestedCapabilities: [], resources: [{ id: "guide", mediaType: "text/markdown",
        contentHash: hash(resourceContent) }], routing: { priority: 1, keywords: [] },
      attribution: "测试资源" };
    const draft = await skills.saveDraft({ skillId: definition.id, semanticVersion: "1.0.0",
      content: "主指令", manifest });
    await assert.rejects(skills.publish({ revisionId: draft.id,
      expectedContentHash: draft.contentHash }), /resource declarations are incomplete/);
    await assert.rejects(skills.registerResource({ revisionId: draft.id, resourceId: "guide",
      mediaType: "text/markdown", content: "错版资源" }), /differs from the declared/);
    await skills.registerResource({ revisionId: draft.id, resourceId: "guide",
      mediaType: "text/markdown", content: resourceContent });
    await skills.publish({ revisionId: draft.id, expectedContentHash: draft.contentHash });
    await skills.activate({ skillId: definition.id, revisionId: draft.id, expectedBindingVersion: 0 });
    const runtime = createAgentRuntime({ work: async (operation) => operation(db),
      now: () => 200 + serial, createId: () => `run-resource-${++serial}`,
      schedule: () => undefined, openTextCall: async () => { throw new Error("not executing Model"); } });
    const run = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "resource-run", content: "读取技能资源" });
    await skills.bindRun({ runId: run.id, projectId: 7, skillIds: [definition.id] });
    const loaded = await skills.loadResource({ runId: run.id, projectId: 7,
      skillId: definition.id, resourceId: "guide" });
    assert.equal(loaded.content, resourceContent);
    assert.equal(loaded.contentHash, hash(resourceContent));
    const access = await db("o_agentSkillResourceAccess").where({ id: loaded.accessId }).first();
    assert.equal(access.runId, run.id);
    assert.equal(access.skillRevisionId, draft.id);
    assert.equal(access.resourceId, "guide");
    assert.equal(access.contentHash, hash(resourceContent));
    await assert.rejects(db("o_agentSkillResourceAccess").where({ id: loaded.accessId })
      .update({ contentHash: "tampered" }), /immutable/);
    await assert.rejects(skills.loadResource({ runId: run.id, projectId: 9,
      skillId: definition.id, resourceId: "guide" }), /outside authorized Run binding/);
    assert.equal((await db("o_agentSkillResourceAccess")).length, 1,
      "rejected access must not create a successful access record");
    await assert.rejects(skills.loadResource({ runId: run.id, projectId: 7,
      skillId: definition.id, resourceId: "../data/skills/secret.md" }), /resource request is invalid/);
    await assert.rejects(db("o_agentSkillResourceRevision").where({ skillRevisionId: draft.id })
      .update({ content: "篡改" }), /immutable/);
    const deprecated = await skills.setRevisionLifecycle({ revisionId: draft.id,
      expectedVersion: 1, nextState: "deprecated" });
    assert.equal(deprecated.state, "deprecated");
    assert.equal((await skills.loadResource({ runId: run.id, projectId: 7,
      skillId: definition.id, resourceId: "guide" })).content, resourceContent,
    "deprecation affects new Runs, not historical inspection");
    const newerRun = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "resource-new-run", content: "尝试已弃用技能" });
    await assert.rejects(skills.bindRun({ runId: newerRun.id, projectId: 7,
      skillIds: [definition.id] }), /deprecated or revoked/);
    await assert.rejects(skills.activate({ skillId: definition.id,
      revisionId: draft.id, expectedBindingVersion: 1 }), /active Revision policy/);
    await skills.setRevisionLifecycle({ revisionId: draft.id, expectedVersion: 2,
      nextState: "revoked" });
    await assert.rejects(skills.loadResource({ runId: run.id, projectId: 7,
      skillId: definition.id, resourceId: "guide" }), /was revoked/);
    await assert.rejects(skills.bindRun({ runId: run.id, projectId: 7,
      skillIds: [definition.id] }), /was revoked/);
    await assert.rejects(db("o_agentSkillRevisionPolicy").where({ revisionId: draft.id })
      .update({ state: "active", version: 4 }), /one-way/);
  } finally { await db.destroy(); }
});
