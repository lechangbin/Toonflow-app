import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime, PRODUCTION_HARNESS_ROLE,
  PRODUCTION_HARNESS_SCOPE } from "../src/agentRuntime";
import { prepareProductionSkillRun } from
  "../src/agents/productionAgent/harnessPreparation";
import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { createProjectSkillGrantRuntime, resolveProductionSkillGrants } from
  "../src/skillRuntime/grants";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from
  "../src/skillRuntime/manifest";

test("opt-in Production guidance Run freezes Skill and reads workspace through a guarded Tool", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert({ id: 7, userId: 1, name: "生产项目" });
    await db("o_script").insert({ id: 11, projectId: 7, name: "第一集",
      content: "剧本内容" });
    await db("o_agentWorkData").insert({ projectId: 7, episodesId: 11,
      key: "productionAgent", data: JSON.stringify({ scriptPlan: "三段拍摄计划" }) });
    let serial = 0;
    const createId = () => `production-run-${++serial}`;
    const work = async <T>(operation: (database: typeof db) => Promise<T> | T) => operation(db);
    const skills = createSkillRuntime({ work, now: () => 100, createId });
    const definition = await skills.createDefinition({
      name: "production-guidance", description: "只读生产规划" });
    const manifest: SkillManifest = { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
      skillId: definition.id, semanticVersion: "1.0.0",
      compatibleRoles: ["productionAgent"], intents: ["read-only-guidance"],
      dependencies: [], requestedTools: ["get_production_workspace_text"],
      requestedCapabilities: ["read:production-workspace"], resources: [],
      routing: { priority: 1, keywords: [] }, attribution: "T17 定向测试" };
    const draft = await skills.saveDraft({ skillId: definition.id,
      semanticVersion: "1.0.0", content: "只读检查拍摄计划", manifest });
    await skills.publish({ revisionId: draft.id,
      expectedContentHash: draft.contentHash });
    await skills.activate({ skillId: definition.id, revisionId: draft.id,
      expectedBindingVersion: 0 });
    await createProjectSkillGrantRuntime({ work, now: () => 150 })
      .setReadProductionWorkspace({ projectId: 7, actorUserId: 1,
        expectedVersion: 0, active: true });
    const queue: Array<() => Promise<void>> = [];
    let modelCalls = 0;
    const runtime = createAgentRuntime({ work, now: () => 200, createId,
      schedule: (item) => queue.push(item), productionMode: true,
      prepareRun: (tx, input) => prepareProductionSkillRun(tx, input, createId),
      skillMode: { grants: resolveProductionSkillGrants },
      openTextCall: async (target) => {
        assert.deepEqual(target, { kind: "logical", key: "productionAgent:decisionAgent" });
        return { target: { vendorId: "fake", modelId: "text-v1",
          contextWindowTokens: 50_000, maxOutputTokens: 256 },
          invokeText: async (callInput) => {
            modelCalls++;
            assert.deepEqual(Object.keys(callInput.tools!), ["get_production_workspace_text"]);
            const result = await callInput.tools!.get_production_workspace_text.execute!(
              { scriptId: 11, key: "scriptPlan" },
              { toolCallId: "production-read-one", messages: [] });
            assert.equal((result as { content?: string }).content, "三段拍摄计划");
            return { text: "拍摄计划已核对；未执行生成" } as any;
          } };
      } });
    const input = { schemaVersion: "toonflow.agent-run.start.v1" as const,
      projectId: 7, role: PRODUCTION_HARNESS_ROLE,
      scope: PRODUCTION_HARNESS_SCOPE, clientRequestId: "production-guidance-1",
      content: "检查第一集拍摄计划", actorUserId: 1 };
    const run = await runtime.start(input);
    assert.equal((await db("o_agentRunSkillBinding").where({ runId: run.id }).first())?.revisionId,
      draft.id);
    await assert.rejects(runtime.start({ ...input,
      clientRequestId: "wrong-owner-production", actorUserId: 2 }), /Project owner/);
    assert.equal(await runtime.inspect({ runId: run.id, projectId: 7,
      actorUserId: 2 }), null);
    assert.equal(await runtime.inspect({ runId: run.id, projectId: 7 }), null);
    assert.deepEqual(await runtime.list({ projectId: 7, role: PRODUCTION_HARNESS_ROLE,
      scope: PRODUCTION_HARNESS_SCOPE, actorUserId: 2 }),
    { current: null, recent: [] });
    while (queue.length) await queue.shift()!();
    assert.equal(modelCalls, 1);
    assert.equal((await runtime.inspect({ runId: run.id, projectId: 7,
      actorUserId: 1 }))?.status, "succeeded");
    assert.equal((await db("o_agentToolReceipt").where({ runId: run.id,
      toolName: "get_production_workspace_text", status: "succeeded" })).length, 1);
    assert.equal((await db("o_agentSkillPermissionDecision").where({ runId: run.id })).length, 1);
    assert.equal((await runtime.start(input)).id, run.id);
    assert.equal(modelCalls, 1, "idempotent retry never calls Model again");
    const cancelled = await runtime.start({ ...input,
      clientRequestId: "production-cancel-before-model" });
    assert.equal((await runtime.cancel({ runId: cancelled.id, projectId: 7,
      actorUserId: 1, clientCommandId: "stop-production", expectedVersion: 1 }))?.status,
    "cancelled");
    while (queue.length) await queue.shift()!();
    assert.equal(modelCalls, 1, "cancelled queued Run never calls Model");
    const scriptRuntime = createAgentRuntime({ work, now: () => 220, createId,
      schedule: () => { throw new Error("default Runtime must not schedule"); },
      openTextCall: async () => { throw new Error("default Runtime must not call Model"); } });
    assert.equal(await scriptRuntime.inspect({ runId: run.id, projectId: 7,
      actorUserId: 1 }), null, "Script Runtime cannot inspect a Production Run");
  } finally { await db.destroy(); }
});
