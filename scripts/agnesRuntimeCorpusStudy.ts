/** Opt-in T11 study runner. The first command only prepares; run executes serial cells. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import knexFactory from "knex";

import { createAgentRuntime, PRODUCTION_HARNESS_SCOPE,
  SCRIPT_HARNESS_SCOPE } from "../src/agentRuntime";
import { prepareProductionSkillRun } from "../src/agents/productionAgent/harnessPreparation";
import { prepareScriptSkillRun } from "../src/agents/scriptAgent/harnessPreparation";
import { createEvaluationAgentCase } from "../src/eval/evaluationAgentCase";
import { freezeAgentRuntimeEvaluationRun } from "../src/eval/agentRuntimeEvaluationFreeze";
import { validateAgentRuntimeCorpus } from "../src/eval/agentRuntimeCorpus";
import { materializeAgentRuntimeProjectFixture,
  verifyMaterializedAgentRuntimeProjectFixture } from "../src/eval/agentRuntimeProjectFixture";
import { createEvaluationRunRuntime, parseEvaluationRevisions } from "../src/eval/evaluationRun";
import { inspectRuntimeCorpusCellGates } from "../src/eval/runtimeCorpusGateVerifier";
import { runRuntimeCorpusMatrix } from "../src/eval/runtimeCorpusMatrixDriver";
import { assertT11AgnesTextBinding, bindT11AgnesTextCall,
  T11_AGNES_TEXT_POLICY_REVISION } from "../src/eval/runtimeCorpusModelPolicy";
import { openSanitizedRuntimeCorpusCheckpoint,
  writeSanitizedRuntimeCorpusCheckpoint } from "../src/eval/runtimeCorpusCheckpoint";
import { openRuntimeCorpusExecutionJournal } from "../src/eval/runtimeCorpusExecutionJournal";
import { activateT11TreatmentSkillVariant,
  publishT11TreatmentSkills } from "../src/eval/runtimeCorpusTreatmentSkills";
import { assertSkillOnlyRuntimeCorpusTreatment } from "../src/eval/runtimeCorpusTreatment";
import { readRuntimeCorpusStudyPlan, writeRuntimeCorpusStudyPlan } from
  "../src/eval/runtimeCorpusStudyPlan";
import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { createProjectSkillGrantRuntime, resolveProductionSkillGrants,
  resolveReadOnlyScriptSkillGrants } from "../src/skillRuntime/grants";
import { createConfiguredVendor } from "../src/vendor";
import { VideoPromptProfileRegistry } from "../src/video/promptProfile";

const source = (file: string) => fs.readFile(path.resolve(file));
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const revision = async (file: string) => digest(await source(file));
const PROJECT_ID = 7;
let observedStage = "startup";
let observedCellId: string | null = null;

async function configureAgnes(db: ReturnType<typeof knexFactory>, apiKey: string) {
  await db("o_vendorConfig").where({ id: "agnes" }).update({
    inputValues: JSON.stringify({ apiKey, baseUrl: "https://apihub.agnes-ai.com" }), enable: 1 });
  for (const key of ["scriptAgent:decisionAgent", "productionAgent:decisionAgent"]) {
    const changed = await db("o_agentDeploy").where({ key }).update({
      model: "agnes-3.0-flash", modelName: "agnes:agnes-3.0-flash",
      vendorId: "agnes", temperature: 0, maxOutputTokens: 512 });
    if (changed !== 1) throw new Error("T11 required Agent Model deployment is missing");
  }
}

async function staticRevisions() {
  return { app: await revision("src/agentRuntime/index.ts"),
    schema: await revision("src/lib/initDB.ts"),
    runtime: await revision("src/agentRuntime/index.ts"),
    tool: await revision("src/controlledTools/definitions.ts"),
    context: await revision("src/context/index.ts"),
    memory: await revision("src/memory/projectMemory.ts"),
    model: T11_AGNES_TEXT_POLICY_REVISION,
    vendor: await revision("data/vendor/agnes.ts") };
}

async function main() {
  const [mode, directoryArg, countArg] = process.argv.slice(2);
  if (!(["prepare", "run"] as string[]).includes(mode) || !directoryArg
    || (mode === "run" && (!countArg || !/^[1-9]\d*$/u.test(countArg)))) {
    throw new TypeError("Usage: agnesRuntimeCorpusStudy.ts prepare|run ABSOLUTE_DATA_DIR [MAX_NEW_CELLS]");
  }
  if (!path.isAbsolute(directoryArg)) throw new TypeError("T11 data directory must be absolute");
  const directory = path.resolve(directoryArg);
  const repository = path.resolve(".");
  if (directory === repository || directory.startsWith(`${repository}${path.sep}`)) {
    throw new TypeError("T11 data directory must be outside the Git repository");
  }
  const maxNewCells = mode === "run" ? Number(countArg) : 0;
  if (mode === "run" && (!Number.isSafeInteger(maxNewCells) || maxNewCells > 72)) {
    throw new TypeError("T11 batch size must be a positive integer at most 72");
  }
  const apiKey = process.env.AGNES_API_KEY;
  if (!apiKey || apiKey.length < 8) throw new Error("AGNES_API_KEY is required in the process environment");
  const manifestSource = (await source("data/eval/agent-runtime-corpus-v1/manifest.json")).toString();
  const corpus = validateAgentRuntimeCorpus(JSON.parse(manifestSource) as unknown);
  const fixtureSource = await source("data/eval/fixtures/agent-runtime-project-v1.json");
  const expectedFixtureHash = corpus.cases[0].fixture.sha256;
  if (corpus.cases.some((cell) => cell.fixture.sha256 !== expectedFixtureHash)) {
    throw new Error("T11 runner requires one isolated Project fixture");
  }
  const policy = await staticRevisions();
  let db: ReturnType<typeof knexFactory>;
  let openedPlan: Awaited<ReturnType<typeof readRuntimeCorpusStudyPlan>> | undefined;
  let checkpoint: { sha256: string; sequence: number } | undefined;
  if (mode === "prepare") {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const realDirectory = await fs.realpath(directory);
    const realRepository = await fs.realpath(repository);
    if (realDirectory === realRepository
      || realDirectory.startsWith(`${realRepository}${path.sep}`)) {
      throw new TypeError("T11 real data directory must be outside the Git repository");
    }
    if ((await fs.readdir(directory)).length !== 0) {
      throw new Error("T11 preparation requires an empty private data directory");
    }
    db = knexFactory({ client: "better-sqlite3",
      connection: { filename: ":memory:" }, useNullAsDefault: true,
      pool: { min: 1, max: 1 } });
  } else {
    const realDirectory = await fs.realpath(directory);
    const realRepository = await fs.realpath(repository);
    if (realDirectory === realRepository
      || realDirectory.startsWith(`${realRepository}${path.sep}`)) {
      throw new TypeError("T11 real data directory must be outside the Git repository");
    }
    const raw = JSON.parse(await fs.readFile(path.join(directory, "study-plan.json"), "utf8")) as
      { body?: { evaluationRunId?: string; manifestHash?: string } };
    openedPlan = await readRuntimeCorpusStudyPlan({ directory,
      evaluationRunId: raw.body?.evaluationRunId ?? "",
      manifestHash: raw.body?.manifestHash ?? "",
      modelPolicyRevision: T11_AGNES_TEXT_POLICY_REVISION });
    const numbers = (await fs.readdir(directory)).flatMap((name) => {
      const match = /^checkpoint-(\d{4,})\.sqlite$/u.exec(name);
      return match ? [Number(match[1])] : [];
    });
    if (numbers.length === 0) throw new Error("T11 checkpoint is missing");
    const sequence = Math.max(...numbers);
    const opened = await openSanitizedRuntimeCorpusCheckpoint(path.join(directory,
      `checkpoint-${String(sequence).padStart(4, "0")}.sqlite`));
    db = opened.db;
    checkpoint = { sha256: opened.sha256, sequence };
  }
  const work = async <T>(operation: (database: typeof db) => Promise<T> | T) => operation(db);
  let journal: Awaited<ReturnType<typeof openRuntimeCorpusExecutionJournal>> | undefined;
  try {
    if (mode === "prepare") {
      await db.raw("PRAGMA foreign_keys = OFF");
      await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
      const originalLog = console.log;
      console.log = () => undefined;
      try { await initDB(db); } finally { console.log = originalLog; }
      await materializeAgentRuntimeProjectFixture({ work, source: fixtureSource,
        expectedHash: expectedFixtureHash, projectId: PROJECT_ID });
      await db("o_setting").insert({ key: "agentUseMode", value: "1" });
      const grants = createProjectSkillGrantRuntime({ work, now: Date.now });
      const grantInput = { projectId: PROJECT_ID, actorUserId: 1,
        expectedVersion: 0, active: true };
      await grants.setReadNovel(grantInput);
      await grants.setReadScript(grantInput);
      await grants.setReadScriptWorkspace(grantInput);
      await grants.setReadProductionWorkspace(grantInput);
    }
    await configureAgnes(db, apiKey);
    const createId = () => randomUUID();
    const skills = createSkillRuntime({ work, now: Date.now, createId });
    const evaluation = createEvaluationRunRuntime({ work, now: Date.now, createId });
    let plan = openedPlan;
    if (mode === "prepare") {
      const treatment = await publishT11TreatmentSkills({ skills, work, corpusSource: manifestSource });
      const frozen = await freezeAgentRuntimeEvaluationRun(evaluation, {
        manifestSource, studyId: `agnes-t11-${randomUUID()}`, seeds: [11, 29],
        baseline: { ...policy, skill: treatment.revisions.baseline.fingerprint },
        candidate: { ...policy, skill: treatment.revisions.candidate.fingerprint },
        frozenAt: Date.now(), projectIds: Object.fromEntries(corpus.cases.map(
          (cell) => [cell.id, PROJECT_ID])), readFixture: async () => fixtureSource });
      assertSkillOnlyRuntimeCorpusTreatment((await evaluation.inspect(frozen.id)).manifest);
      await writeRuntimeCorpusStudyPlan({ directory, evaluationRunId: frozen.id,
        manifestHash: frozen.manifestHash,
        modelPolicyRevision: T11_AGNES_TEXT_POLICY_REVISION, treatment });
      const saved = await writeSanitizedRuntimeCorpusCheckpoint({ db, directory,
        sequence: 0, secretValues: [apiKey] });
      console.log(JSON.stringify({ mode, evaluationRunId: frozen.id,
        expected: 72, observed: 0, checkpointSha256: saved.sha256,
        quality: "unverified", costMicros: null }));
      return;
    }
    assert(plan && checkpoint);
    const frozen = await evaluation.inspect(plan.evaluationRunId);
    if (frozen.manifestHash !== plan.manifestHash
      || frozen.manifest.agentRuntimeCorpusJson !== manifestSource) {
      throw new Error("T11 frozen manifest differs from the prepared study");
    }
    assertSkillOnlyRuntimeCorpusTreatment(frozen.manifest);
    for (const variant of ["baseline", "candidate"] as const) {
      if (JSON.stringify(frozen.manifest[variant]) !== JSON.stringify(
        parseEvaluationRevisions({ ...policy,
          skill: plan.treatment.revisions[variant].fingerprint }))) {
        throw new Error("T11 frozen revisions differ from the current source or treatment");
      }
    }
    const vendor = createConfiguredVendor({ work,
      readVendorSource: (vendorId) => {
        if (vendorId !== "agnes") throw new Error("Unexpected T11 Vendor");
        return readFileSync(path.resolve("data/vendor/agnes.ts"), "utf8");
      },
      writeVendorSource: () => { throw new Error("T11 study cannot write Vendor source"); },
      deleteVendorSource: () => { throw new Error("T11 study cannot delete Vendor source"); },
      promptProfiles: VideoPromptProfileRegistry.load(path.resolve("data/promptProfiles/video")),
    });
    const verifyModels = async () => {
      for (const key of ["scriptAgent:decisionAgent",
        "productionAgent:decisionAgent"] as const) {
        assertT11AgnesTextBinding((await vendor.openTextCall({ kind: "logical", key })).target);
      }
    };
    const currentRevisions = async () => {
      await verifyModels();
      const active = await import("../src/eval/runtimeCorpusSkillBinding").then(
        ({ inspectRuntimeCorpusSkillBinding }) => inspectRuntimeCorpusSkillBinding({ work,
          scriptSkillId: plan.treatment.scriptSkillId,
          productionSkillId: plan.treatment.productionSkillId }));
      return { ...await staticRevisions(), skill: active.revision };
    };
    const scheduled: Array<() => Promise<void>> = [];
    let modelInvocations = 0;
    const openTextCall = async (target: Parameters<typeof vendor.openTextCall>[0]) => {
      const call = bindT11AgnesTextCall(await vendor.openTextCall(target));
      return { ...call, invokeText: (input: Parameters<typeof call.invokeText>[0]) => {
        modelInvocations++;
        if (modelInvocations > maxNewCells) throw new Error("T11 batch Model invocation ceiling exceeded");
        return call.invokeText(input);
      } };
    };
    const ordinary = createAgentRuntime({ work, now: Date.now, createId,
      schedule: (item) => scheduled.push(item), openTextCall });
    const script = createAgentRuntime({ work, now: Date.now, createId,
      schedule: (item) => scheduled.push(item), openTextCall,
      prepareRun: (tx, input) => prepareScriptSkillRun(tx, input, createId),
      skillMode: { grants: resolveReadOnlyScriptSkillGrants } });
    const production = createAgentRuntime({ work, now: Date.now, createId,
      productionMode: true, schedule: (item) => scheduled.push(item), openTextCall,
      prepareRun: (tx, input) => prepareProductionSkillRun(tx, input, createId),
      skillMode: { grants: resolveProductionSkillGrants } });
    const adapter = createEvaluationAgentCase({ evaluation,
      runtimeForCase: ({ scope }) => scope === PRODUCTION_HARNESS_SCOPE ? production
        : scope === SCRIPT_HARNESS_SCOPE ? script : ordinary,
      currentRevisions,
      awaitScheduledWork: async () => { while (scheduled.length) await scheduled.shift()!(); },
      verifyProjectFixture: async ({ projectId, fixture }) =>
        verifyMaterializedAgentRuntimeProjectFixture({ work, source: fixtureSource,
          expectedHash: fixture.sha256, projectId }) });
    journal = await openRuntimeCorpusExecutionJournal(directory, plan.evaluationRunId);
    const result = await runRuntimeCorpusMatrix({ evaluation, evaluationRunId: plan.evaluationRunId,
      journal, db, directory, checkpoint, secretValues: [apiKey], maxNewCells,
      preflight: async (cell) => {
        observedStage = "preflight";
        observedCellId = cell.cellId;
        await activateT11TreatmentSkillVariant({ skills, work,
          corpusSource: manifestSource, plan: plan.treatment, variant: cell.variant });
        if (JSON.stringify(parseEvaluationRevisions(await currentRevisions()))
          !== JSON.stringify(frozen.manifest[cell.variant])) {
          throw new Error("T11 actual revisions differ before external Model call");
        }
        await verifyMaterializedAgentRuntimeProjectFixture({ work, source: fixtureSource,
          expectedHash: expectedFixtureHash, projectId: PROJECT_ID });
      },
      execute: async (cell) => {
        observedStage = "execute";
        observedCellId = cell.cellId;
        const definition = corpus.cases.find((entry) => entry.id === cell.caseId)!;
        await adapter.execute({ evaluationRunId: plan.evaluationRunId,
          variant: cell.variant, caseId: cell.caseId, seed: cell.seed,
          projectId: PROJECT_ID, actorUserId: 1, role: definition.role,
          scope: definition.scope, content: definition.content });
      },
      afterCell: async (cell) => {
        observedStage = "after-checkpoint";
        observedCellId = cell.cellId;
        const observed = await evaluation.inspect(plan.evaluationRunId);
        const recorded = observed.cases.find((item) => item.variant === cell.variant
          && item.caseId === cell.caseId && item.seed === cell.seed);
        if (!recorded || recorded.runStatus !== "succeeded") {
          throw new Error("T11 non-successful Run checkpointed; stop before the next Provider call");
        }
        const gate = await inspectRuntimeCorpusCellGates({ work, evaluation,
          evaluationRunId: plan.evaluationRunId, variant: cell.variant,
          caseId: cell.caseId, seed: cell.seed,
          readFixture: async () => fixtureSource });
        if (gate.state !== "verified-read-and-safety-only") {
          // A semantic/behavioral hard-gate failure remains in the fixed denominator.
          // Fail closed here because an unexpected safety failure needs inspection.
          throw new Error("T11 machine gate failure checkpointed; stop before the next Provider call");
        }
      } });
    console.log(JSON.stringify({ mode, evaluationRunId: plan.evaluationRunId,
      ...result, modelInvocations, quality: "unverified", costMicros: null }));
  } finally {
    await journal?.close();
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error("Agnes T11 study failed:", JSON.stringify({ stage: observedStage,
    cellId: observedCellId, errorName: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
});
