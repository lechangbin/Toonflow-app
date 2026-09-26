/** Opt-in live canary: one read-only Production AgentRun against Agnes. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { stepCountIs } from "ai";
import knexFactory from "knex";

import { createAgentRuntime, PRODUCTION_HARNESS_ROLE,
  PRODUCTION_HARNESS_SCOPE } from "../src/agentRuntime";
import { prepareProductionSkillRun } from "../src/agents/productionAgent/harnessPreparation";
import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { createProjectSkillGrantRuntime, resolveProductionSkillGrants } from
  "../src/skillRuntime/grants";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from
  "../src/skillRuntime/manifest";
import { createConfiguredVendor } from "../src/vendor";
import { VideoPromptProfileRegistry } from "../src/video/promptProfile";

async function main(): Promise<void> {
  const apiKey = process.env.AGNES_API_KEY;
  if (!apiKey) throw new Error("AGNES_API_KEY must be set for this opt-in live canary");
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }

    await db("o_vendorConfig").where({ id: "agnes" }).update({
      inputValues: JSON.stringify({ apiKey, baseUrl: "https://apihub.agnes-ai.com" }),
      // Fixture-only override, not a statement of Agnes' published capacity.
      models: JSON.stringify([{ name: "Agnes 3.0 Flash canary budget",
        modelName: "agnes-3.0-flash", type: "text", think: true,
        contextWindowTokens: 4096 }]),
      enable: 1,
    });
    await db("o_agentDeploy").where({ key: "productionAgent:decisionAgent" }).update({
      model: "agnes-3.0-flash", modelName: "agnes:agnes-3.0-flash",
      vendorId: "agnes", temperature: 0, maxOutputTokens: 256,
    });
    await db("o_setting").insert({ key: "agentUseMode", value: "1" });
    await db("o_project").insert({ id: 7, userId: 1, name: "Agnes 只读探针" });
    await db("o_script").insert({ id: 11, projectId: 7, name: "第一集", content: "剧本内容" });
    await db("o_agentWorkData").insert({ projectId: 7, episodesId: 11,
      key: "productionAgent", data: JSON.stringify({ scriptPlan: "三段拍摄计划" }) });

    const createId = () => randomUUID();
    const work = async <T>(operation: (database: typeof db) => Promise<T> | T) => operation(db);
    const skills = createSkillRuntime({ work, now: Date.now, createId });
    const definition = await skills.createDefinition({
      name: "agnes-production-read-canary", description: "真实模型只读生产规划探针" });
    const manifest: SkillManifest = { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
      skillId: definition.id, semanticVersion: "1.0.0",
      compatibleRoles: ["productionAgent"], intents: ["read-only-guidance"],
      dependencies: [], requestedTools: ["get_production_workspace_text"],
      requestedCapabilities: ["read:production-workspace"], resources: [],
      routing: { priority: 1, keywords: [] }, attribution: "T17 Agnes live canary" };
    const draft = await skills.saveDraft({ skillId: definition.id,
      semanticVersion: "1.0.0", content: "仅读取拍摄计划并简述，不提出任何生成或写入。", manifest });
    await skills.publish({ revisionId: draft.id, expectedContentHash: draft.contentHash });
    await skills.activate({ skillId: definition.id, revisionId: draft.id,
      expectedBindingVersion: 0 });
    const grants = createProjectSkillGrantRuntime({ work, now: Date.now });
    await grants.setReadProductionWorkspace({ projectId: 7, actorUserId: 1,
      expectedVersion: 0, active: true });

    const vendor = createConfiguredVendor({
      work,
      readVendorSource: (vendorId) => {
        if (vendorId !== "agnes") throw new Error("Unexpected Vendor in live canary");
        return readFileSync(path.resolve("data/vendor/agnes.ts"), "utf8");
      },
      writeVendorSource: () => { throw new Error("Live canary cannot write Vendor source"); },
      deleteVendorSource: () => { throw new Error("Live canary cannot delete Vendor source"); },
      promptProfiles: VideoPromptProfileRegistry.load(path.resolve("data/promptProfiles/video")),
    });
    const queue: Array<() => Promise<void>> = [];
    let modelCalls = 0;
    const runtime = createAgentRuntime({ work, now: Date.now, createId,
      schedule: (item) => queue.push(item), productionMode: true,
      prepareRun: (tx, input) => prepareProductionSkillRun(tx, input, createId),
      skillMode: { grants: resolveProductionSkillGrants },
      openTextCall: async (target) => {
        assert.deepEqual(target, { kind: "logical", key: "productionAgent:decisionAgent" });
        const call = await vendor.openTextCall(target);
        return { ...call, invokeText: (input) => {
          modelCalls++;
          return call.invokeText({ ...input, stopWhen: stepCountIs(2) });
        } };
      },
    });
    const started = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: PRODUCTION_HARNESS_ROLE, scope: PRODUCTION_HARNESS_SCOPE,
      clientRequestId: "agnes-production-read-canary", actorUserId: 1,
      content: "请使用 get_production_workspace_text 读取第一集（scriptId=11）的 scriptPlan，然后用一句话概述。" });
    assert.equal(queue.length, 1, "exactly one Run worker is scheduled");
    await queue.shift()!();

    const snapshot = await runtime.inspect({ runId: started.id, projectId: 7, actorUserId: 1 });
    const outputs = await db("o_agentRunOutput").where({ runId: started.id });
    const receipts = await db("o_agentToolReceipt").where({ runId: started.id });
    const vendorRequests = await db("o_agentVendorRequest");
    const persistedRun = await db("o_agentRun").where({ id: started.id }).first();
    const result = {
      runStatus: snapshot?.status ?? "missing", modelCalls,
      readReceipts: receipts.filter((row) => row.toolName === "get_production_workspace_text"
        && row.status === "succeeded").length,
      otherReceipts: receipts.filter((row) => row.toolName !== "get_production_workspace_text").length,
      vendorRequests: vendorRequests.length,
      outputCount: outputs.length,
      outputSha256: outputs.length === 1
        ? createHash("sha256").update(outputs[0].content).digest("hex") : null,
      failureDiagnostic: persistedRun?.failureDiagnostic
        ? JSON.parse(persistedRun.failureDiagnostic) : null,
    };
    console.log(JSON.stringify(result));
    assert.equal(result.modelCalls, 1);
    assert.equal(result.vendorRequests, 0);
    assert.equal(result.otherReceipts, 0);
    assert.equal(result.runStatus, "succeeded");
    assert.equal(result.readReceipts, 1);
    assert.equal(result.outputCount, 1);
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error("Agnes Production canary failed:", error instanceof Error ? error.name : "UnknownError");
  process.exitCode = 1;
});
