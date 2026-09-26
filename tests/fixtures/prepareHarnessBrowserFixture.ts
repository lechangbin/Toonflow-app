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
    await runtime.work(async (db) => {
      await db("o_project").insert({ id: projectId, userId: 1,
        projectType: "novel", name: "Harness browser fixture", intro: "isolated fake Model",
        type: "测试", imageModel: "", imageQuality: "", artStyle: "",
        videoVendorId: "", videoModelId: "", videoCapabilityId: "",
        videoOutputPresetId: "", videoRatio: "16:9", createTime: projectId });
      await db("o_vendorConfig").where({ id: "deepseek" }).update({ enable: 1,
        inputValues: JSON.stringify({ apiKey: "fixture-only-no-provider",
          baseUrl: "http://127.0.0.1:10689/v1" }),
        models: JSON.stringify([{ name: "Local Fixture", modelName: "fixture-text",
          type: "text", think: false, contextWindowTokens: 50_000 }]) });
      await db("o_agentDeploy").where({ id: 1 }).update({ vendorId: "deepseek",
        modelName: "deepseek:fixture-text" });
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
    console.log(JSON.stringify({ dataRoot, projectId, webDist }));
  } finally {
    await closeDatabase();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
