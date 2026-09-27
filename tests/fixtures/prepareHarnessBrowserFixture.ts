import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Isolated local-only fixture; does not configure a paid Provider or touch user data. */
async function main() {
  const sourceData = path.resolve("data");
  const webDist = path.resolve(process.env.HARNESS_WEB_DIST || path.join(sourceData, "web"));
  if (!(await fs.stat(path.join(webDist, "index.html"))).isFile()) {
    throw new Error("HARNESS_WEB_DIST must contain a built index.html");
  }
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "toonflow-harness-browser-"));
  for (const name of ["vendor", "skills", "promptProfiles", "models"]) {
    await fs.cp(path.join(sourceData, name), path.join(dataRoot, name), { recursive: true });
  }
  await fs.cp(webDist, path.join(dataRoot, "web"), { recursive: true });
  process.env.DATA_DIR = dataRoot;
  const { openDatabase, closeDatabase } = await import("../../src/database");
  const { createSkillRuntime } = await import("../../src/skillRuntime");
  const { createProjectSkillGrantRuntime } = await import("../../src/skillRuntime/grants");
  const previousLog = console.log;
  let runtime;
  try {
    console.log = () => undefined;
    runtime = await openDatabase();
  } finally {
    console.log = previousLog;
  }
  try {
    const projectId = Date.now();
    const scriptId = 11;
    await runtime.work(async (db) => {
      await db("o_project").insert({ id: projectId, userId: 1,
        projectType: "novel", name: "Harness browser fixture", intro: "isolated fake Model",
        type: "测试", imageModel: "", imageQuality: "", artStyle: "",
        videoVendorId: "", videoModelId: "", videoCapabilityId: "",
        videoOutputPresetId: "", videoRatio: "16:9", createTime: projectId });
      await db("o_script").insert({ id: scriptId, projectId,
        name: "浏览器测试第一集", content: "隔离测试剧本，不用于真实生成" });
      await db("o_agentWorkData").insert({ projectId, episodesId: scriptId,
        key: "productionAgent", data: JSON.stringify({ scriptPlan: "本地测试的三段拍摄计划" }) });
      await db("o_vendorConfig").where({ id: "deepseek" }).update({ enable: 1,
        inputValues: JSON.stringify({ apiKey: "fixture-only-no-provider",
          baseUrl: "http://127.0.0.1:10689/v1" }),
        models: JSON.stringify([{ name: "Local Fixture", modelName: "fixture-text",
          type: "text", think: false, contextWindowTokens: 50_000 }]) });
      await db("o_agentDeploy").where({ id: 1 }).update({ vendorId: "deepseek",
        modelName: "deepseek:fixture-text" });
      await db("o_setting").where({ key: "agentUseMode" }).update({ value: "1" });
      await db("o_agentDeploy").whereIn("key", ["scriptAgent:decisionAgent",
        "productionAgent:decisionAgent"]).update({
        vendorId: "deepseek", model: "fixture-text", modelName: "deepseek:fixture-text",
        temperature: 0, maxOutputTokens: 256 });
    });
    const skills = createSkillRuntime({ work: runtime.work,
      now: () => Date.now(), createId: randomUUID });
    const definition = await skills.createDefinition({ name: "browser-guidance",
      description: "isolated browser fixture" });
    const draft = await skills.saveDraft({ skillId: definition.id,
      semanticVersion: "1.0.0", content: "只提供只读的本地测试建议。",
      manifest: { schemaVersion: "toonflow.skill-manifest.v1",
        skillId: definition.id, semanticVersion: "1.0.0",
        compatibleRoles: ["scriptAgent"], intents: ["read-only-guidance", "script-proposal"],
        dependencies: [], requestedTools: ["propose_script_workspace_write"],
        requestedCapabilities: ["propose:script-workspace"], resources: [],
        routing: { priority: 10, keywords: [] }, attribution: "local-browser-fixture" } });
    await skills.publish({ revisionId: draft.id, expectedContentHash: draft.contentHash });
    await skills.activate({ skillId: definition.id, revisionId: draft.id,
      expectedBindingVersion: 0 });
    const productionDefinition = await skills.createDefinition({ name: "browser-production-guidance",
      description: "isolated production browser fixture" });
    const productionDraft = await skills.saveDraft({ skillId: productionDefinition.id,
      semanticVersion: "1.0.0", content: "只读取已授权的生产工作区并给出本地测试建议。",
      manifest: { schemaVersion: "toonflow.skill-manifest.v1",
        skillId: productionDefinition.id, semanticVersion: "1.0.0",
        compatibleRoles: ["productionAgent"], intents: ["read-only-guidance"],
        dependencies: [], requestedTools: ["get_production_workspace_text"],
        requestedCapabilities: ["read:production-workspace"], resources: [],
        routing: { priority: 10, keywords: [] }, attribution: "local-browser-fixture" } });
    await skills.publish({ revisionId: productionDraft.id,
      expectedContentHash: productionDraft.contentHash });
    await skills.activate({ skillId: productionDefinition.id, revisionId: productionDraft.id,
      expectedBindingVersion: 0 });
    const grants = createProjectSkillGrantRuntime({ work: runtime.work, now: Date.now });
    await grants.setReadProductionWorkspace({ projectId, actorUserId: 1,
      expectedVersion: 0, active: true });
    console.log(JSON.stringify({ dataRoot, projectId, scriptId, webDist }));
  } finally {
    await closeDatabase();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
