import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime } from "../src/agentRuntime";
import { prepareScriptSkillRun } from "../src/agents/scriptAgent/harnessPreparation";
import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from "../src/skillRuntime/manifest";

test("opt-in Script preparation freezes one routed Skill before Model scheduling and rejects ambiguity", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert({ id: 7, userId: 1, name: "剧本迁移项目" });
    let serial = 0;
    const work = async <T>(operation: (database: typeof db) => Promise<T> | T) => operation(db);
    const createId = () => `script-prep-${++serial}`;
    const skills = createSkillRuntime({ work, now: () => 100, createId });
    const publish = async (name: string) => {
      const definition = await skills.createDefinition({ name, description: name });
      const manifest: SkillManifest = { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
        skillId: definition.id, semanticVersion: "1.0.0", compatibleRoles: ["scriptAgent"],
        intents: ["read-only-guidance"], dependencies: [], requestedTools: [],
        requestedCapabilities: [], resources: [], routing: { priority: 10, keywords: [] },
        attribution: "Script 迁移定向测试" };
      const draft = await skills.saveDraft({ skillId: definition.id,
        semanticVersion: "1.0.0", content: `只读指导 ${name}`, manifest });
      await skills.publish({ revisionId: draft.id, expectedContentHash: draft.contentHash });
      await skills.activate({ skillId: definition.id, revisionId: draft.id,
        expectedBindingVersion: 0 });
      return { skillId: definition.id, revisionId: draft.id };
    };
    const first = await publish("script-guidance-1");
    let scheduled = 0;
    const runtime = createAgentRuntime({ work, now: () => 200,
      createId, schedule: () => { scheduled++; },
      openTextCall: async () => { throw new Error("not executing Model"); },
      prepareRun: (tx, input) => prepareScriptSkillRun(tx, input, createId) });
    const input = { schemaVersion: "toonflow.agent-run.start.v1" as const,
      projectId: 7, role: "scriptAgent" as const,
      scope: "read-only-project-guidance-v1" as const,
      clientRequestId: "prepared-script-run", content: "分析章节" };
    const run = await runtime.start(input);
    assert.equal(scheduled, 1);
    assert.equal((await db("o_agentRunSkillBinding").where({ runId: run.id }).first())?.revisionId,
      first.revisionId);
    assert.equal((await db("o_agentSkillRouteDecision").where({ runId: run.id }).first())?.runId,
      run.id);
    assert.equal((await db("o_agentRunSkillResolution").where({ runId: run.id }).first())?.runId,
      run.id);
    assert.equal((await runtime.start(input)).id, run.id);
    assert.equal(scheduled, 1, "idempotent start does not reprepare or schedule");
    await publish("script-guidance-2");
    await assert.rejects(runtime.start({ ...input,
      clientRequestId: "ambiguous-script-run" }), /unique selection: needs-attention/);
    assert.equal((await db("o_agentRun").where({ clientRequestId: "ambiguous-script-run" })).length, 0);
    assert.equal((await db("o_agentSkillRouteDecision").where({ runId: run.id })).length, 1);
    assert.equal(scheduled, 1, "ambiguous preparation never schedules a Model");
  } finally { await db.destroy(); }
});
