import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime } from "../src/agentRuntime";
import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from "../src/skillRuntime/manifest";
import { createSkillDependencyResolver } from "../src/skillRuntime/resolution";

test("Skill resolver orders an exact published dependency closure and rejects missing, cyclic or incompatible branches", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert({ id: 7, userId: 1, name: "依赖测试项目" });
    let serial = 0;
    const skills = createSkillRuntime({ work: async (operation) => operation(db),
      now: () => 100 + serial, createId: () => `resolution-${++serial}` });
    const define = async (name: string) => skills.createDefinition({ name, description: name });
    const [a, b, c, missingRoot, cycleA, cycleB, roleRoot, roleChild] = await Promise.all([
      define("skill-a"), define("skill-b"), define("skill-c"), define("skill-missing"),
      define("skill-cycle-a"), define("skill-cycle-b"), define("skill-role-root"), define("skill-role-child"),
    ]);
    const publish = async (skillId: string, dependencies: SkillManifest["dependencies"] = [],
      compatibleRoles = ["scriptAgent"]) => {
      const manifest: SkillManifest = { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
        skillId, semanticVersion: "1.0.0", compatibleRoles,
        intents: ["read-only-guidance"], dependencies, requestedTools: [],
        requestedCapabilities: [], resources: [], routing: { priority: 1, keywords: [] },
        attribution: "定向测试" };
      const draft = await skills.saveDraft({ skillId, semanticVersion: "1.0.0",
        content: `Skill ${skillId}`, manifest });
      await skills.publish({ revisionId: draft.id, expectedContentHash: draft.contentHash });
      return draft;
    };
    const exact = (skillId: string) => ({ skillId, semanticVersion: "1.0.0" });
    await publish(c.id);
    await publish(b.id, [exact(c.id)]);
    const aRevision = await publish(a.id, [exact(c.id), exact(b.id)]);
    await skills.activate({ skillId: a.id, revisionId: aRevision.id, expectedBindingVersion: 0 });
    const resolver = createSkillDependencyResolver(async (operation) => operation(db));
    const plan = await resolver.resolve({ role: "scriptAgent", rootSkillIds: [a.id] });
    assert.deepEqual(plan.revisions.map((entry) => entry.skillId), [c.id, b.id, a.id]);
    assert.equal(plan.dependencies.length, 3);
    assert.deepEqual(await resolver.resolve({ role: "scriptAgent", rootSkillIds: [a.id] }), plan);
    const runtime = createAgentRuntime({ work: async (operation) => operation(db),
      now: () => 200 + serial, createId: () => `run-resolution-${++serial}`,
      schedule: () => undefined, openTextCall: async () => { throw new Error("not executing Model"); } });
    const run = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "resolved-run", content: "解析依赖" });
    assert.deepEqual(await skills.bindResolvedRun({ runId: run.id, projectId: 7,
      rootSkillIds: [a.id] }), plan);
    assert.deepEqual((await db("o_agentRunSkillBinding").where({ runId: run.id })
      .orderBy("skillId")).map((entry) => entry.skillId), [a.id, b.id, c.id].sort());
    await assert.rejects(skills.bindResolvedRun({ runId: run.id, projectId: 7,
      rootSkillIds: [a.id] }), /already frozen/);
    const cRevision = plan.revisions.find((entry) => entry.skillId === c.id)!;
    await skills.setRevisionLifecycle({ revisionId: cRevision.revisionId,
      expectedVersion: 1, nextState: "deprecated" });
    await assert.rejects(resolver.resolve({ role: "scriptAgent", rootSkillIds: [a.id] }),
      /deprecated or revoked/);
    const failedRun = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "failed-resolved-run", content: "拒绝弃用依赖" });
    await assert.rejects(skills.bindResolvedRun({ runId: failedRun.id, projectId: 7,
      rootSkillIds: [a.id] }), /deprecated or revoked/);
    assert.equal((await db("o_agentRunSkillBinding").where({ runId: failedRun.id })).length, 0);
    const missingDraft = await publish(missingRoot.id, [exact("missing-dependency")]);
    await skills.activate({ skillId: missingRoot.id, revisionId: missingDraft.id, expectedBindingVersion: 0 });
    await assert.rejects(resolver.resolve({ role: "scriptAgent", rootSkillIds: [missingRoot.id] }),
      /missing or corrupt/);
    const cycleADraft = await publish(cycleA.id, [exact(cycleB.id)]);
    await publish(cycleB.id, [exact(cycleA.id)]);
    await skills.activate({ skillId: cycleA.id, revisionId: cycleADraft.id, expectedBindingVersion: 0 });
    await assert.rejects(resolver.resolve({ role: "scriptAgent", rootSkillIds: [cycleA.id] }), /cycle/);
    await publish(roleChild.id, [], ["productionAgent"]);
    const roleDraft = await publish(roleRoot.id, [exact(roleChild.id)]);
    await skills.activate({ skillId: roleRoot.id, revisionId: roleDraft.id, expectedBindingVersion: 0 });
    await assert.rejects(resolver.resolve({ role: "scriptAgent", rootSkillIds: [roleRoot.id] }),
      /incompatible with Agent role/);
  } finally { await db.destroy(); }
});
