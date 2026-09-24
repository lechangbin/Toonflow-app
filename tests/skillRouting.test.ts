import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime } from "../src/agentRuntime";
import { deleteProjectAgentEvidence } from "../src/agentRuntime/retention";
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
    await db("o_project").insert({ id: 7, userId: 1, name: "路由测试项目" });
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
    const runtime = createAgentRuntime({ work: async (operation) => operation(db),
      now: () => 200 + serial, createId: () => `run-routing-${++serial}`,
      schedule: () => undefined, openTextCall: async () => { throw new Error("not executing Model"); } });
    const run = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "route-evidence", content: "请分析章节" });
    const auditedRouter = createSkillRouter(async (operation) => operation(db),
      { now: () => 300 + serial, createId: () => `route-${++serial}` });
    const audited = await auditedRouter.routeForRun({ runId: run.id, projectId: 7,
      intent: "chapter-guidance", query: "请分析章节" });
    assert.deepEqual(audited.decision, tied);
    const stored = await db("o_agentSkillRouteDecision").where({ id: audited.id }).first();
    assert.equal(stored.runId, run.id);
    assert.equal(stored.decisionJson, JSON.stringify(tied));
    assert.equal(stored.decisionJson.includes("请分析章节"), false);
    assert.match(stored.queryHash, /^[a-f0-9]{64}$/);
    await assert.rejects(auditedRouter.routeForRun({ runId: run.id, projectId: 9,
      intent: "chapter-guidance", query: "跨项目" }), /queued Run in Project scope/);
    await assert.rejects(db("o_agentSkillRouteDecision").where({ id: audited.id })
      .update({ decisionJson: "{}" }), /immutable/);
    await assert.rejects(db("o_agentSkillRouteDecision").where({ id: audited.id }).delete(),
      /durable evidence/);
    const tiedRun = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "tied-route-bind", content: "并列技能" });
    const tiedBinding = await skills.routeAndBindRun({ runId: tiedRun.id, projectId: 7,
      intent: "chapter-guidance", query: "请分析章节" });
    assert.equal(tiedBinding.decision.status, "needs-attention");
    assert.equal(tiedBinding.plan, null);
    assert.equal((await db("o_agentRunSkillBinding").where({ runId: tiedRun.id })).length, 0);
    assert.equal((await db("o_agentRunSkillResolution").where({ runId: tiedRun.id })).length, 0);
    await db("o_agentSkillBinding").where({ skillId: second.skillId }).delete();
    const selected = await router.route({ role: "scriptAgent", intent: "chapter-guidance",
      query: "请分析章节" });
    assert.equal(selected.status, "selected");
    assert.deepEqual(selected.selected, first);
    const selectedRun = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "selected-route-bind", content: "单一技能" });
    const selectedBinding = await skills.routeAndBindRun({ runId: selectedRun.id,
      projectId: 7, intent: "chapter-guidance", query: "请分析章节" });
    assert.deepEqual(selectedBinding.decision.selected, first);
    assert.equal(selectedBinding.plan?.revisions.at(-1)?.revisionId, first.revisionId);
    assert.equal((await db("o_agentRunSkillBinding").where({ runId: selectedRun.id })).length, 1);
    assert.equal((await db("o_agentRunSkillResolution").where({ runId: selectedRun.id })).length, 1);
    await assert.rejects(skills.routeAndBindRun({ runId: selectedRun.id,
      projectId: 7, intent: "chapter-guidance", query: "请分析章节" }), /already frozen/);
    await skills.setRevisionLifecycle({ revisionId: first.revisionId,
      expectedVersion: 1, nextState: "deprecated" });
    const deprecated = await router.route({ role: "scriptAgent", intent: "chapter-guidance",
      query: "请分析章节" });
    assert.equal(deprecated.status, "unavailable");
    assert.equal(deprecated.candidates.find((candidate) => candidate.skillId === first.skillId)?.reason,
      "deprecated");
    await skills.setRevisionLifecycle({ revisionId: first.revisionId,
      expectedVersion: 2, nextState: "revoked" });
    const revoked = await router.route({ role: "scriptAgent", intent: "chapter-guidance",
      query: "请分析章节" });
    assert.equal(revoked.candidates.find((candidate) => candidate.skillId === first.skillId)?.reason,
      "revoked");
    const unavailable = await router.route({ role: "scriptAgent", intent: "storyboard",
      query: "章节" });
    assert.equal(unavailable.status, "unavailable");
    await db.transaction(async (tx) => {
      await tx("o_project").where({ id: 7 }).delete();
      await deleteProjectAgentEvidence(tx, 7);
    });
    assert.equal((await db("o_agentSkillRouteDecision")).length, 0);
  } finally { await db.destroy(); }
});
