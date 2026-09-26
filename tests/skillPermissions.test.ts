import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime } from "../src/agentRuntime";
import { createControlledToolRuntime, TOOL_DEFINITIONS } from "../src/controlledTools";
import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from "../src/skillRuntime/manifest";
import { evaluateSkillToolPermission } from "../src/skillRuntime/permissions";

test("Skill Tool authority is the intersection of declared request and all independent grants", () => {
  const input = { toolName: "get_novel_text", toolRequiredCapabilities: ["read:novel"],
    skillRequestedTools: ["get_novel_text"], skillRequestedCapabilities: ["read:novel"],
    platformGrants: ["read:novel"], projectGrants: ["read:novel"],
    runGrants: ["read:novel"], roleGrants: ["read:novel"] };
  assert.equal(evaluateSkillToolPermission(input).allowed, true);
  const denied = evaluateSkillToolPermission({ ...input, projectGrants: [], runGrants: [] });
  assert.equal(denied.allowed, false);
  assert.deepEqual(denied.missing, [
    { layer: "project", capability: "read:novel" },
    { layer: "run", capability: "read:novel" },
  ]);
  assert.deepEqual(evaluateSkillToolPermission({ ...input, skillRequestedTools: [] }).missing,
    [{ layer: "skill-tool-request", capability: "get_novel_text" }]);
  assert.deepEqual(evaluateSkillToolPermission({ ...input, skillRequestedCapabilities: [] }).missing,
    [{ layer: "skill-capability-request", capability: "read:novel" }]);
});

test("guarded Tool execution requires a frozen Skill request and every external grant", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert({ id: 7, userId: 1, name: "授权测试项目" });
    await db("o_novel").insert({ id: 10, projectId: 7, chapterIndex: 1,
      chapter: "开篇", chapterData: "只读正文" });
    let serial = 0;
    const work = async <T>(operation: (database: typeof db) => Promise<T> | T) => operation(db);
    const skills = createSkillRuntime({ work, now: () => 100,
      createId: () => `permission-${++serial}` });
    const definition = await skills.createDefinition({ name: "read-novel", description: "只读小说" });
    const manifest: SkillManifest = { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
      skillId: definition.id, semanticVersion: "1.0.0", compatibleRoles: ["scriptAgent"],
      intents: ["read-only-guidance"], dependencies: [], requestedTools: ["get_novel_text"],
      requestedCapabilities: ["read:novel"], resources: [],
      routing: { priority: 1, keywords: [] }, attribution: "授权测试" };
    const draft = await skills.saveDraft({ skillId: definition.id,
      semanticVersion: "1.0.0", content: "只读", manifest });
    await skills.publish({ revisionId: draft.id, expectedContentHash: draft.contentHash });
    await skills.activate({ skillId: definition.id, revisionId: draft.id,
      expectedBindingVersion: 0 });
    const agent = createAgentRuntime({ work, now: () => 100,
      createId: () => `run-permission-${++serial}`, schedule: () => undefined,
      openTextCall: async () => { throw new Error("not executing Model"); } });
    const run = await agent.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "permission-run", content: "阅读章节" });
    await skills.bindResolvedRun({ runId: run.id, projectId: 7,
      rootSkillIds: [definition.id] });
    await db("o_agentRun").where({ id: run.id }).update({ status: "running",
      leaseOwnerId: "worker", leaseEpoch: "epoch", leaseExpiresAt: 200, fence: 1 });
    const lease = { runId: run.id, ownerId: "worker", epoch: "epoch", expiresAt: 200, fence: 1 };
    const grants = { platformGrants: ["read:novel"], projectGrants: ["read:novel"],
      runGrants: ["read:novel"], roleGrants: ["read:novel"] };
    let adapterCalls = 0;
    const makeTools = (projectGrants: string[]) => createControlledToolRuntime({ work,
      now: () => 100, createId: () => `tool-permission-${++serial}`,
      skillGrants: async () => ({ ...grants, projectGrants }),
      adapters: { get_novel_text: async () => {
        adapterCalls++;
        return { novelId: 10, chapterIndex: 1, chapter: "开篇", text: "只读正文" };
      } } });
    const request = (operationId: string, skillId?: string) => ({ runId: run.id,
      projectId: 7, operationId, toolName: "get_novel_text" as const,
      revision: TOOL_DEFINITIONS.get_novel_text.revision, input: { novelId: 10 }, lease,
      ...(skillId ? { skillId } : {}) });
    assert.equal((await makeTools(grants.projectGrants).execute(request("no-skill"))).status, "rejected");
    assert.equal((await makeTools(grants.projectGrants).execute(request("wrong-skill", "unknown"))).status,
      "rejected");
    assert.equal((await makeTools([]).execute(request("no-project-grant", definition.id))).status,
      "rejected");
    const deniedDecision = await db("o_agentSkillPermissionDecision")
      .where({ runId: run.id, operationId: "no-project-grant" }).first();
    assert.equal(JSON.parse(deniedDecision.decisionJson).allowed, false);
    assert.equal(deniedDecision.decisionJson.includes("只读正文"), false);
    assert.equal((await makeTools(grants.projectGrants)
      .execute(request("no-project-grant", definition.id))).status, "rejected",
    "a denied operation must not become authorized under the same identity");
    assert.equal(adapterCalls, 0);
    assert.equal((await makeTools(grants.projectGrants).execute(request("authorized", definition.id))).status,
      "recorded");
    assert.equal(adapterCalls, 1);
    const allowedDecision = await db("o_agentSkillPermissionDecision")
      .where({ runId: run.id, operationId: "authorized" }).first();
    assert.equal(JSON.parse(allowedDecision.decisionJson).allowed, true);
    assert.equal(allowedDecision.skillRevisionId, draft.id);
    await assert.rejects(db("o_agentSkillPermissionDecision")
      .where({ id: allowedDecision.id }).update({ decisionJson: "{}" }), /immutable/);
    await skills.setRevisionLifecycle({ revisionId: draft.id, expectedVersion: 1,
      nextState: "revoked" });
    assert.equal((await makeTools(grants.projectGrants).execute(request("revoked", definition.id))).status,
      "rejected");
    assert.equal(adapterCalls, 1);
  } finally { await db.destroy(); }
});
