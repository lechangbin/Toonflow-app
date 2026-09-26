/** Opt-in T11 vertical slice: one production Runtime corpus cell, never a 72-cell quality claim. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { stepCountIs } from "ai";
import knexFactory from "knex";

import { createAgentRuntime, PRODUCTION_HARNESS_ROLE,
  PRODUCTION_HARNESS_SCOPE } from "../src/agentRuntime";
import { prepareProductionSkillRun } from "../src/agents/productionAgent/harnessPreparation";
import { createEvaluationAgentCase } from "../src/eval/evaluationAgentCase";
import { freezeAgentRuntimeEvaluationRun } from "../src/eval/agentRuntimeEvaluationFreeze";
import { validateAgentRuntimeCorpus } from "../src/eval/agentRuntimeCorpus";
import { materializeAgentRuntimeProjectFixture,
  verifyMaterializedAgentRuntimeProjectFixture } from "../src/eval/agentRuntimeProjectFixture";
import { createEvaluationRunRuntime } from "../src/eval/evaluationRun";
import { inspectRuntimeCorpusCellGates } from "../src/eval/runtimeCorpusGateVerifier";
import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { createProjectSkillGrantRuntime, resolveProductionSkillGrants } from
  "../src/skillRuntime/grants";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from
  "../src/skillRuntime/manifest";
import { createConfiguredVendor } from "../src/vendor";
import { VideoPromptProfileRegistry } from "../src/video/promptProfile";

const read = (file: string) => readFileSync(path.resolve(file));
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const revision = (file: string) => sha256(read(file));

async function main(): Promise<void> {
  const apiKey = process.env.AGNES_API_KEY;
  if (!apiKey) throw new Error("AGNES_API_KEY must be set for the opt-in T11 canary");
  const manifestSource = read("data/eval/agent-runtime-corpus-v1/manifest.json").toString();
  const corpus = validateAgentRuntimeCorpus(JSON.parse(manifestSource) as unknown);
  const definition = corpus.cases.find((entry) => entry.id === "DEV-RT-009")!;
  assert.equal(definition.role, PRODUCTION_HARNESS_ROLE);
  assert.equal(definition.scope, PRODUCTION_HARNESS_SCOPE);
  const fixtureSource = read(definition.fixture.path);
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    const work = async <T>(operation: (database: typeof db) => Promise<T> | T) => operation(db);
    const createId = () => randomUUID();
    await materializeAgentRuntimeProjectFixture({ work, source: fixtureSource,
      expectedHash: definition.fixture.sha256, projectId: 7 });
    await db("o_vendorConfig").where({ id: "agnes" }).update({
      inputValues: JSON.stringify({ apiKey, baseUrl: "https://apihub.agnes-ai.com" }), enable: 1 });
    await db("o_agentDeploy").where({ key: "productionAgent:decisionAgent" }).update({
      model: "agnes-3.0-flash", modelName: "agnes:agnes-3.0-flash",
      vendorId: "agnes", temperature: 0, maxOutputTokens: 512 });
    await db("o_setting").insert({ key: "agentUseMode", value: "1" });
    const skillRuntime = createSkillRuntime({ work, now: Date.now, createId });
    const skill = await skillRuntime.createDefinition({ name: "t11-production-read-canary",
      description: "T11 single-cell read-only Production evaluation" });
    const skillManifest: SkillManifest = { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
      skillId: skill.id, semanticVersion: "1.0.0",
      compatibleRoles: ["productionAgent"], intents: ["read-only-guidance"],
      dependencies: [], requestedTools: ["get_production_workspace_text"],
      requestedCapabilities: ["read:production-workspace"], resources: [],
      routing: { priority: 1, keywords: [] }, attribution: "T11 isolated canary" };
    const draft = await skillRuntime.saveDraft({ skillId: skill.id,
      semanticVersion: "1.0.0", content: "仅读取当前 Project 拍摄计划并简述，不提案、不写入、不调用生成。",
      manifest: skillManifest });
    await skillRuntime.publish({ revisionId: draft.id, expectedContentHash: draft.contentHash });
    await skillRuntime.activate({ skillId: skill.id, revisionId: draft.id,
      expectedBindingVersion: 0 });
    await createProjectSkillGrantRuntime({ work, now: Date.now })
      .setReadProductionWorkspace({ projectId: 7, actorUserId: 1,
        expectedVersion: 0, active: true });
    const vendor = createConfiguredVendor({ work,
      readVendorSource: (vendorId) => {
        if (vendorId !== "agnes") throw new Error("Unexpected Vendor in T11 canary");
        return read("data/vendor/agnes.ts").toString();
      },
      writeVendorSource: () => { throw new Error("Canary cannot write Vendor source"); },
      deleteVendorSource: () => { throw new Error("Canary cannot delete Vendor source"); },
      promptProfiles: VideoPromptProfileRegistry.load(path.resolve("data/promptProfiles/video")),
    });
    const revisions = { app: revision("src/agentRuntime/index.ts"),
      schema: revision("src/lib/initDB.ts"), runtime: revision("src/agentRuntime/index.ts"),
      tool: revision("src/controlledTools/definitions.ts"),
      context: revision("src/context/index.ts"),
      memory: revision("src/memory/projectMemory.ts"), skill: draft.contentHash,
      model: "agnes-3.0-flash", vendor: revision("data/vendor/agnes.ts") };
    const evaluation = createEvaluationRunRuntime({ work, now: Date.now, createId });
    const frozen = await freezeAgentRuntimeEvaluationRun(evaluation, {
      manifestSource, studyId: "agnes-t11-single-cell-canary", seeds: [11, 29],
      baseline: revisions, candidate: revisions, frozenAt: Date.now(),
      projectIds: Object.fromEntries(corpus.cases.map((entry) => [entry.id, 7])),
      readFixture: async () => fixtureSource });
    const scheduled: Array<() => Promise<void>> = [];
    let modelInvocations = 0;
    const runtime = createAgentRuntime({ work, now: Date.now, createId,
      productionMode: true, schedule: (item) => scheduled.push(item),
      prepareRun: (tx, input) => prepareProductionSkillRun(tx, input, createId),
      skillMode: { grants: resolveProductionSkillGrants },
      openTextCall: async (target) => {
        assert.deepEqual(target, { kind: "logical", key: "productionAgent:decisionAgent" });
        const call = await vendor.openTextCall(target);
        assert.equal(call.target.contextWindowTokens, 524_288);
        return { ...call, invokeText: (input) => {
          modelInvocations++;
          if (modelInvocations > 1) throw new Error("Canary Model budget exceeded");
          return call.invokeText({ ...input, stopWhen: stepCountIs(2) });
        } };
      } });
    const adapter = createEvaluationAgentCase({ evaluation, runtime,
      currentRevisions: async () => revisions,
      awaitScheduledWork: async () => {
        while (scheduled.length) await scheduled.shift()!();
      },
      verifyProjectFixture: async ({ projectId, fixture }) =>
        verifyMaterializedAgentRuntimeProjectFixture({ work, source: fixtureSource,
          expectedHash: fixture.sha256, projectId }) });
    await adapter.execute({ evaluationRunId: frozen.id, variant: "baseline",
      caseId: definition.id, seed: 11, projectId: 7, actorUserId: 1,
      role: definition.role, scope: definition.scope, content: definition.content });
    const observed = await evaluation.inspect(frozen.id);
    const gate = await inspectRuntimeCorpusCellGates({ work, evaluation,
      evaluationRunId: frozen.id, variant: "baseline", caseId: definition.id, seed: 11,
      readFixture: async () => fixtureSource });
    const cell = observed.cases[0];
    console.log(JSON.stringify({ caseId: definition.id, observed: observed.recorded,
      expected: observed.expected, runStatus: cell.runStatus,
      modelInvocations, safetyState: gate.state,
      checkedReceipts: gate.checkedReceipts,
      violations: gate.violations,
      quality: "unverified", costMicros: null }));
  } finally { await db.destroy(); }
}

main().catch((error: unknown) => {
  console.error("Agnes T11 canary failed:", error instanceof Error ? error.name : "UnknownError");
  process.exitCode = 1;
});
