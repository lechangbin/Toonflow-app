import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime } from "../src/agentRuntime";
import { prepareProductionSkillRun } from "../src/agents/productionAgent/harnessPreparation";
import { prepareScriptSkillRun } from "../src/agents/scriptAgent/harnessPreparation";
import { hashAgentRuntimeCorpus, validateAgentRuntimeCorpus } from "../src/eval/agentRuntimeCorpus";
import { createEvaluationAssessmentLedger } from "../src/eval/evaluationAssessment";
import { createEvaluationAssessmentQueue } from "../src/eval/evaluationAssessmentQueue";
import { createEvaluationCoverageReport } from "../src/eval/evaluationCoverageReport";
import { createEvaluationAgentCase } from "../src/eval/evaluationAgentCase";
import { assertRuntimeCorpusSafetyReadyForResume, createRuntimeCorpusSafetyReport,
  inspectRuntimeCorpusCellGates } from "../src/eval/runtimeCorpusGateVerifier";
import { createRuntimeCorpusEvidenceArtifacts,
  verifyRuntimeCorpusEvidenceArtifactProvenance } from "../src/eval/runtimeCorpusEvidenceArtifacts";
import { createRuntimeCorpusBlindReviewBatch } from "../src/eval/runtimeCorpusBlindReview";
import { createEvaluationPairedAssessmentReport } from "../src/eval/evaluationPairedAssessmentReport";
import { createEvaluationRunRuntime, evaluationCaseRequestId } from "../src/eval/evaluationRun";
import { freezeAgentRuntimeEvaluationRun } from "../src/eval/agentRuntimeEvaluationFreeze";
import { materializeAgentRuntimeProjectFixture,
  verifyMaterializedAgentRuntimeProjectFixture } from "../src/eval/agentRuntimeProjectFixture";
import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { createProjectSkillGrantRuntime, resolveProductionSkillGrants,
  resolveReadOnlyScriptSkillGrants } from
  "../src/skillRuntime/grants";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from
  "../src/skillRuntime/manifest";

const fixtureSource = fs.readFileSync(path.resolve("data/eval/fixtures/agent-runtime-project-v1.json"), "utf8");
const digest = createHash("sha256").update(fixtureSource).digest("hex");
const caseDefinition = (index: number) => ({
  id: `${index < 12 ? "DEV" : index < 15 ? "HOLD" : "INC"}-RT-${String(index + 1).padStart(3, "0")}`,
  partition: index < 12 ? "development" : index < 15 ? "holdout" : "incident-regression",
  title: `Runtime situation ${index + 1}`,
  role: "scriptAgent", scope: "read-only-project-guidance-v1",
  content: `Describe source evidence for situation ${index + 1}.`,
  fixture: { id: `project-${index + 1}`, path: `data/eval/fixtures/project-${index + 1}.json`, sha256: digest },
  hardGates: [{ id: "project-scope", statement: "Only the frozen Project may be read" }],
  expectedToolCalls: [{ name: "get_novel_text", input: { novelId: 10 } }],
  requiredArtifacts: ["agent-run-output"],
  expectedFailureClass: { primary: "None", stage: "agent-run", kind: "none" },
  rubric: { focus: "Grounded response", anchors: [0, 1, 2].map((score) =>
    ({ score, description: `Grounding anchor ${score}` })) },
});

const manifest = () => ({ schemaVersion: "toonflow.agent-runtime-corpus.v1",
  suiteId: "agent-runtime-corpus-v1", qualityRubricVersion: "runtime-quality@1",
  cases: Array.from({ length: 18 }, (_, index) => caseDefinition(index)) });

test("T11 checked-in Runtime corpus has 18 concrete requests bound to real fixture bytes", () => {
  const source = fs.readFileSync(path.resolve("data/eval/agent-runtime-corpus-v1/manifest.json"), "utf8");
  const corpus = validateAgentRuntimeCorpus(JSON.parse(source) as unknown);
  assert.equal(corpus.cases.length, 18);
  assert.equal(new Set(corpus.cases.map((item) => item.content)).size, 18);
  assert.ok(corpus.cases.every((item) => !item.content.includes(item.id)));
  assert.equal(corpus.cases[12].optionalToolCalls?.length, 6);
  assert.equal(corpus.cases[16].optionalToolCalls?.length, 2);
  for (const item of corpus.cases) {
    const bytes = fs.readFileSync(path.resolve(item.fixture.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), item.fixture.sha256);
  }
});

test("T11 Runtime corpus has its own 18-case identity and normalized source hash", () => {
  const parsed = validateAgentRuntimeCorpus(manifest());
  assert.equal(parsed.cases.length, 18);
  assert.equal(parsed.cases[12].partition, "holdout");
  const source = JSON.stringify(manifest(), null, 2);
  assert.equal(hashAgentRuntimeCorpus(source), hashAgentRuntimeCorpus(source.replace(/\n/gu, "\r\n")));
  assert.throws(() => validateAgentRuntimeCorpus({ ...manifest(),
    schemaVersion: "toonflow.golden-eval-manifest.v1" }), /schemaVersion/u);
});

test("T11 Runtime corpus rejects incomplete, duplicate and capability-incompatible definitions", () => {
  assert.throws(() => validateAgentRuntimeCorpus({ ...manifest(),
    cases: manifest().cases.slice(1) }), /18 cases/u);
  const duplicate = manifest();
  duplicate.cases[1].id = duplicate.cases[0].id;
  assert.throws(() => validateAgentRuntimeCorpus(duplicate), /duplicate|ordered/u);
  const reordered = manifest();
  [reordered.cases[0], reordered.cases[1]] = [reordered.cases[1], reordered.cases[0]];
  assert.throws(() => validateAgentRuntimeCorpus(reordered), /ordered/u);
  const wrongScope = manifest();
  wrongScope.cases[0].scope = "production-harness-v1";
  assert.throws(() => validateAgentRuntimeCorpus(wrongScope), /role.*scope/u);
  const noFixture = manifest();
  noFixture.cases[0].fixture.sha256 = "unfrozen";
  assert.throws(() => validateAgentRuntimeCorpus(noFixture), /fixture|sha256/u);
  const optionalWrongScope = JSON.parse(fs.readFileSync(path.resolve(
    "data/eval/agent-runtime-corpus-v1/manifest.json"), "utf8")) as {
      cases: Array<{ optionalToolCalls?: unknown[] }> };
  optionalWrongScope.cases[12].optionalToolCalls = [
    { name: "get_production_workspace_text", input: { scriptId: 11, key: "scriptPlan" } }];
  assert.throws(() => validateAgentRuntimeCorpus(optionalWrongScope), /outside the case scope/u);
});

test("T11 freezes a separate Runtime corpus with 72 missing cells and verified fixture bytes", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  const previousLog = console.log;
  console.log = () => {};
  try { await initDB(db); } finally { console.log = previousLog; }
  try {
    const revisions = { app: "app-1", schema: "schema-1", runtime: "runtime-1",
      tool: "tool-1", context: "context-1", memory: "memory-1",
      skill: "skill-1", model: "model-1", vendor: "vendor-1" };
    const evaluation = createEvaluationRunRuntime({ work: async (operation) => operation(db),
      now: () => 200, createId: () => "runtime-corpus-run" });
    const source = JSON.stringify(manifest());
    const input = { manifestSource: source, studyId: "runtime-study-v1", seeds: [11, 29],
      baseline: revisions, candidate: { ...revisions, app: "app-2" }, frozenAt: 100,
      projectIds: Object.fromEntries(manifest().cases.map((item) => [item.id, 7])),
      readFixture: async (_path: string) => fixtureSource };
    const created = await freezeAgentRuntimeEvaluationRun(evaluation, input);
    const frozen = await evaluation.inspect(created.id);
    assert.equal(frozen.manifest.schemaVersion, "toonflow.evaluation-run.v3");
    assert.equal(frozen.manifest.goldenManifestJson, undefined);
    assert.equal(frozen.manifest.agentRuntimeCorpusJson, source);
    assert.ok(frozen.manifest.caseInputs.every((item) => item.actorUserId === 1));
    assert.equal(frozen.expected, 72);
    assert.equal(frozen.recorded, 0);
    const coverage = await createEvaluationCoverageReport(evaluation, created.id);
    assert.equal(coverage.definedCases, 18);
    assert.equal(coverage.expectedPerVariant, 36);
    assert.equal(coverage.caseManifestHash, hashAgentRuntimeCorpus(source));
    const queue = await createEvaluationAssessmentQueue(evaluation, created.id);
    assert.equal(queue.expected, 72);
    assert.equal(queue.pendingAssessment, 72);
    assert.equal(queue.cells[0].hardGates[0].id, "project-scope");
    const ledger = createEvaluationAssessmentLedger({ work: async (operation) => operation(db),
      evaluation, now: () => 300, createId: () => "assessment-1" });
    assert.equal((await ledger.inspect(created.id)).expected, 72);
    const paired = await createEvaluationPairedAssessmentReport(evaluation, ledger, created.id);
    assert.equal(paired.expectedPairs, 36);
    assert.equal(paired.observedRuns, 0);
    await assert.rejects(freezeAgentRuntimeEvaluationRun(evaluation, { ...input,
      readFixture: async () => "changed" }), /fixture.*hash/u);
  } finally { await db.destroy(); }
});

test("T11 materializes a hash-bound isolated Project fixture atomically", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  const previousLog = console.log;
  console.log = () => {};
  try { await initDB(db); } finally { console.log = previousLog; }
  try {
    const reordered = JSON.parse(fs.readFileSync(path.resolve(
      "data/eval/fixtures/agent-runtime-project-v1.json"), "utf8")) as {
        novels: unknown[]; events: unknown[] };
    reordered.novels.reverse();
    reordered.events.reverse();
    const source = JSON.stringify(reordered);
    const expectedHash = createHash("sha256").update(source).digest("hex");
    const work = async <T>(operation: (database: typeof db) => Promise<T> | T) => operation(db);
    await assert.rejects(materializeAgentRuntimeProjectFixture({ work,
      source, expectedHash: "0".repeat(64), projectId: 7 }), /fixture.*hash/u);
    assert.equal((await db("o_project").where({ id: 7 })).length, 0);
    const result = await materializeAgentRuntimeProjectFixture({ work,
      source, expectedHash, projectId: 7 });
    assert.equal(result.projectId, 7);
    assert.equal(result.novelCount, 3);
    assert.equal((await db("o_novel").where({ projectId: 7 })).length, 3);
    assert.equal((await db("o_script").where({ projectId: 7 })).length, 1);
    assert.equal((await db("o_agentWorkData").where({ projectId: 7 })).length, 2);
    await verifyMaterializedAgentRuntimeProjectFixture({ work,
      source, expectedHash, projectId: 7 });
    await assert.rejects(verifyMaterializedAgentRuntimeProjectFixture({ work,
      source, expectedHash, projectId: 8 }), /Project.*fixture|fixture.*Project/u);
    await db("o_novel").where({ id: 10 }).update({ chapterData: "tampered" });
    await assert.rejects(verifyMaterializedAgentRuntimeProjectFixture({ work,
      source, expectedHash, projectId: 7 }), /Project.*fixture|fixture.*Project/u);
    await assert.rejects(materializeAgentRuntimeProjectFixture({ work,
      source, expectedHash, projectId: 7 }), /already exists/u);
    assert.equal((await db("o_novel").where({ projectId: 7 })).length, 3);
  } finally { await db.destroy(); }
});

test("T11 keeps a genuine unreviewed machine-gate failure visible and blocks resume", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  const previousLog = console.log;
  console.log = () => undefined;
  try { await initDB(db); } finally { console.log = previousLog; }
  try {
    const manifestSource = fs.readFileSync(path.resolve(
      "data/eval/agent-runtime-corpus-v1/manifest.json"), "utf8");
    const corpus = validateAgentRuntimeCorpus(JSON.parse(manifestSource) as unknown);
    const fixtureSource = fs.readFileSync(path.resolve(corpus.cases[0].fixture.path), "utf8");
    const work = async <T>(operation: (database: typeof db) => Promise<T> | T) => operation(db);
    await materializeAgentRuntimeProjectFixture({ work, source: fixtureSource,
      expectedHash: corpus.cases[0].fixture.sha256, projectId: 7 });
    let serial = 0;
    const createId = () => `unreviewed-${++serial}`;
    const revisions = { app: "app-1", schema: "schema-1", runtime: "runtime-1",
      tool: "tool-1", context: "context-1", memory: "memory-1",
      skill: "skill-1", model: "model-1", vendor: "vendor-1" };
    const evaluation = createEvaluationRunRuntime({ work, now: () => 200, createId });
    const frozen = await freezeAgentRuntimeEvaluationRun(evaluation, {
      manifestSource, studyId: "unreviewed-gate", seeds: [11, 29],
      baseline: revisions, candidate: { ...revisions, app: "app-2" }, frozenAt: 100,
      projectIds: Object.fromEntries(corpus.cases.map((cell) => [cell.id, 7])),
      readFixture: async () => fixtureSource });
    const scheduled: Array<() => Promise<void>> = [];
    const runtime = createAgentRuntime({ work, now: () => 250, createId,
      schedule: (item) => scheduled.push(item),
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "text-v1",
        contextWindowTokens: 50_000, maxOutputTokens: 256 },
      invokeText: async () => ({ text: "没有检索来源" } as any) }) });
    const adapter = createEvaluationAgentCase({ evaluation, runtime,
      currentRevisions: async () => revisions,
      awaitScheduledWork: async () => { while (scheduled.length) await scheduled.shift()!(); },
      verifyProjectFixture: async ({ projectId, fixture }) =>
        verifyMaterializedAgentRuntimeProjectFixture({ work, source: fixtureSource,
          expectedHash: fixture.sha256, projectId }) });
    const first = corpus.cases[0];
    const result = await adapter.execute({ evaluationRunId: frozen.id,
      variant: "baseline", caseId: first.id, seed: 11, projectId: 7,
      actorUserId: 1, role: first.role, scope: first.scope, content: first.content });
    assert.equal(result.runStatus, "succeeded");
    const safety = await createRuntimeCorpusSafetyReport({ work, evaluation,
      evaluationRunId: frozen.id, readFixture: async () => fixtureSource });
    assert.deepEqual({ observed: safety.observed, failed: safety.failed, missing: safety.missing },
      { observed: 1, failed: 1, missing: 71 });
    assert.throws(() => assertRuntimeCorpusSafetyReadyForResume(safety),
      /manual reconciliation/u);
    const assessment = createEvaluationAssessmentLedger({ work, evaluation,
      now: () => 300, createId });
    const report = await createEvaluationPairedAssessmentReport(evaluation,
      assessment, frozen.id, { runtimeSafety: { work,
        readFixture: async () => fixtureSource } });
    assert.equal(report.cells[0].baseline.state, "gate-failed");
    assert.ok(report.cells[0].baseline.failedGates.includes("runtime:expected-read-missing"));
    assert.equal(report.cells[0].baseline.score, null);
    assert.equal(report.assessedRuns, 0);
  } finally { await db.destroy(); }
});

test("T11 checked-in corpus can execute one real Runtime cell with a local Fake Model", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  const previousLog = console.log;
  console.log = () => {};
  try { await initDB(db); } finally { console.log = previousLog; }
  let artifactRoot: string | null = null;
  try {
    const manifestSource = fs.readFileSync(path.resolve("data/eval/agent-runtime-corpus-v1/manifest.json"), "utf8");
    const corpus = validateAgentRuntimeCorpus(JSON.parse(manifestSource) as unknown);
    const fixtureSource = fs.readFileSync(path.resolve(corpus.cases[0].fixture.path), "utf8");
    const work = async <T>(operation: (database: typeof db) => Promise<T> | T) => operation(db);
    await materializeAgentRuntimeProjectFixture({ work, source: fixtureSource,
      expectedHash: corpus.cases[0].fixture.sha256, projectId: 7 });
    let serial = 0;
    const revisions = { app: "app-1", schema: "schema-1", runtime: "runtime-1",
      tool: "tool-1", context: "context-1", memory: "memory-1",
      skill: "skill-1", model: "model-1", vendor: "vendor-1" };
    const evaluation = createEvaluationRunRuntime({ work, now: () => 200,
      createId: () => `eval-${++serial}` });
    const frozen = await freezeAgentRuntimeEvaluationRun(evaluation, {
      manifestSource, studyId: "runtime-corpus-local-v1", seeds: [11, 29],
      baseline: revisions, candidate: { ...revisions, app: "app-2" }, frozenAt: 100,
      projectIds: Object.fromEntries(corpus.cases.map((item) => [item.id, 7])),
      readFixture: async () => fixtureSource,
    });
    const scheduled: Array<() => Promise<void>> = [];
    let modelCalls = 0;
    const runtime = createAgentRuntime({ work, now: () => 250,
      createId: () => `run-${++serial}`, schedule: (item) => scheduled.push(item),
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "text-v1",
        contextWindowTokens: 50_000, maxOutputTokens: 256 },
      invokeText: async (callInput) => {
        modelCalls++;
        const source = await callInput.tools!.get_novel_text.execute!(
          { novelId: 10 }, { toolCallId: "runtime-corpus-source-read", messages: [] });
        assert.match((source as { text: string }).text, /暴雨/u);
        return { text: "暴雨误期迫使戍卒商议" } as any;
      } }) });
    const adapter = createEvaluationAgentCase({ evaluation, runtime,
      currentRevisions: async () => revisions,
      awaitScheduledWork: async () => { while (scheduled.length) await scheduled.shift()!(); },
      verifyProjectFixture: async ({ projectId, fixture }) =>
        verifyMaterializedAgentRuntimeProjectFixture({ work,
          source: fs.readFileSync(path.resolve(fixture.path)),
          expectedHash: fixture.sha256, projectId }) });
    const first = corpus.cases[0];
    await adapter.execute({ evaluationRunId: frozen.id, variant: "baseline",
      caseId: first.id, seed: 11, projectId: 7, actorUserId: 1,
      role: first.role, scope: first.scope,
      content: first.content });
    const observed = await evaluation.inspect(frozen.id);
    assert.equal(observed.recorded, 1);
    assert.match(observed.cases[0].sourceAuditHash!, /^[a-f0-9]{64}$/u);
    assert.equal(observed.missing.length, 71);
    assert.equal(modelCalls, 1);
    assert.equal((await db("o_agentRunOutput")).length, 1);
    assert.equal((await db("o_agentToolReceipt").where({ toolName: "get_novel_text",
      status: "succeeded" })).length, 1);
    const originalTrace = await db("o_agentTrace").where({ runId: observed.cases[0].agentRunId })
      .orderBy("sequence", "asc").first();
    await db("o_agentTrace").where({ id: originalTrace.id }).update({ eventType: "rewritten" });
    await assert.rejects(evaluation.inspect(frozen.id), /evidence has changed/u);
    await db("o_agentTrace").where({ id: originalTrace.id })
      .update({ eventType: originalTrace.eventType });
    assert.deepEqual(await db("o_agentTrace").where({ id: originalTrace.id }).first(), originalTrace);
    await evaluation.inspect(frozen.id);
    const originalAuditReceipt = await db("o_agentToolReceipt")
      .where({ runId: observed.cases[0].agentRunId }).first();
    const changedReceiptOutput = JSON.stringify({ text: "changed source" });
    await db("o_agentToolReceipt").where({ id: originalAuditReceipt.id }).update({
      outputJson: changedReceiptOutput,
      outputHash: createHash("sha256").update(changedReceiptOutput).digest("hex") });
    await assert.rejects(evaluation.inspect(frozen.id), /evidence has changed/u);
    await db("o_agentToolReceipt").where({ id: originalAuditReceipt.id }).update({
      outputJson: originalAuditReceipt.outputJson,
      outputHash: originalAuditReceipt.outputHash });
    assert.deepEqual(await db("o_agentToolReceipt")
      .where({ id: originalAuditReceipt.id }).first(), originalAuditReceipt);
    await evaluation.inspect(frozen.id);
    const blind = await createRuntimeCorpusBlindReviewBatch({ work, evaluation,
      evaluationRunId: frozen.id, blindingKey: Buffer.alloc(32, 7) });
    assert.deepEqual({ pairs: blind.expectedPairs, sides: blind.expectedSides },
      { pairs: 36, sides: 72 });
    assert.equal(blind.packets.filter((entry) => entry.state === "ready").length, 1);
    assert.equal(blind.packets.filter((entry) => entry.state === "missing-run").length, 71);
    assert.equal(JSON.stringify(blind.packets).includes("baseline"), false);
    assert.equal(JSON.stringify(blind.packets).includes("candidate"), false);
    assert.equal(JSON.stringify(blind.packets).includes(observed.cases[0].agentRunId), false);
    assert.equal(blind.privateMap.find((entry) => entry.agentRunId === observed.cases[0].agentRunId)
      ?.variant, "baseline");
    const originalOutput = await db("o_agentRunOutput")
      .where({ runId: observed.cases[0].agentRunId }).first();
    for (const field of ["id", "kind"] as const) {
      await db("o_agentRunOutput").where({ id: originalOutput.id })
        .update({ [field]: `${originalOutput[field]}-rewritten` });
      await assert.rejects(evaluation.inspect(frozen.id), /source audit rows/u);
      await db("o_agentRunOutput").where({ runId: observed.cases[0].agentRunId })
        .update({ [field]: originalOutput[field] });
      await evaluation.inspect(frozen.id);
    }
    let racedContent = "伪造的盲评回复";
    const racedEvaluation = { ...evaluation, inspect: async (evaluationRunId: string) => {
      const snapshot = await evaluation.inspect(evaluationRunId);
      await db("o_agentRunOutput").where({ id: originalOutput.id }).update({
        content: racedContent,
        contentHash: createHash("sha256").update(JSON.stringify(racedContent)).digest("hex") });
      return snapshot;
    } };
    await assert.rejects(createRuntimeCorpusBlindReviewBatch({ work,
      evaluation: racedEvaluation, evaluationRunId: frozen.id,
      blindingKey: Buffer.alloc(32, 7) }), /Output is missing, changed or unsafe/u);
    await db("o_agentRunOutput").where({ id: originalOutput.id }).update({
      content: originalOutput.content, contentHash: originalOutput.contentHash });
    const racedGate = await inspectRuntimeCorpusCellGates({ work,
      evaluation: racedEvaluation, evaluationRunId: frozen.id,
      variant: "baseline", caseId: first.id, seed: 11,
      readFixture: async (fixturePath) => fs.readFileSync(path.resolve(fixturePath)) });
    assert.ok(racedGate.violations.includes("output-source-drift"));
    await db("o_agentRunOutput").where({ id: originalOutput.id }).update({
      content: originalOutput.content, contentHash: originalOutput.contentHash });
    await assert.rejects(createRuntimeCorpusEvidenceArtifacts({ work,
      evaluation: racedEvaluation, evaluationRunId: frozen.id,
      variant: "baseline", caseId: first.id, seed: 11 }),
    /Output differs from the frozen source cell/u);
    await db("o_agentRunOutput").where({ id: originalOutput.id }).update({
      content: originalOutput.content, contentHash: originalOutput.contentHash });
    racedContent = "apiKey=sk-test-redaction-fake-123456";
    const unsafeGate = await inspectRuntimeCorpusCellGates({ work,
      evaluation: racedEvaluation, evaluationRunId: frozen.id,
      variant: "baseline", caseId: first.id, seed: 11,
      readFixture: async (fixturePath) => fs.readFileSync(path.resolve(fixturePath)) });
    assert.ok(unsafeGate.violations.includes("output-missing-or-unsafe"));
    await db("o_agentRunOutput").where({ id: originalOutput.id }).update({
      content: originalOutput.content, contentHash: originalOutput.contentHash });
    for (const marker of [first.id, frozen.id, observed.cases[0].agentRunId]) {
      racedContent = `评测标签 ${marker} 不应出现在模型回复中`;
      const leakedControlMarker = await inspectRuntimeCorpusCellGates({ work,
        evaluation: racedEvaluation, evaluationRunId: frozen.id,
        variant: "baseline", caseId: first.id, seed: 11,
        readFixture: async (fixturePath) => fs.readFileSync(path.resolve(fixturePath)) });
      assert.ok(leakedControlMarker.violations.includes("evaluation-control-marker-leak"));
      await db("o_agentRunOutput").where({ id: originalOutput.id }).update({
        content: originalOutput.content, contentHash: originalOutput.contentHash });
    }
    await assert.rejects(createRuntimeCorpusBlindReviewBatch({ work, evaluation,
      evaluationRunId: frozen.id, blindingKey: Buffer.alloc(8) }), /256-bit key/u);
    const gates = await inspectRuntimeCorpusCellGates({ work, evaluation,
      evaluationRunId: frozen.id, variant: "baseline", caseId: first.id, seed: 11,
      readFixture: async (fixturePath) => fs.readFileSync(path.resolve(fixturePath)) });
    assert.equal(gates.state, "verified-read-and-safety-only");
    assert.deepEqual(gates.missingExpectedTools, []);
    assert.equal(gates.checkedReceipts, 1);
    const safety = await createRuntimeCorpusSafetyReport({ work, evaluation,
      evaluationRunId: frozen.id,
      readFixture: async (fixturePath) => fs.readFileSync(path.resolve(fixturePath)) });
    assert.deepEqual({ expected: safety.expected, observed: safety.observed,
      verified: safety.verified, failed: safety.failed, missing: safety.missing },
    { expected: 72, observed: 1, verified: 1, failed: 0, missing: 71 });
    const projected = await createRuntimeCorpusEvidenceArtifacts({ work, evaluation,
      evaluationRunId: frozen.id, variant: "baseline", caseId: first.id, seed: 11 });
    artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-runtime-evidence-"));
    fs.mkdirSync(path.join(artifactRoot, "artifacts"));
    for (const artifact of projected) {
      fs.writeFileSync(path.join(artifactRoot, "artifacts", `${artifact.kind}.json`),
        artifact.content);
    }
    const outputRef = "artifacts/agent-run-output.json";
    const assessment = createEvaluationAssessmentLedger({ work, evaluation,
      now: () => 300, createId: () => `review-${++serial}` });
    await assessment.record({ evaluationRunId: frozen.id, variant: "baseline",
      caseId: first.id, seed: 11, assessorId: "fixture-reviewer", method: "manual-review",
      hardGates: first.hardGates.map((gate) => ({ id: gate.id, passed: true,
        evidenceRefs: [outputRef] })),
      artifacts: projected.map(({ kind, sha256 }) => ({ kind,
        ref: `artifacts/${kind}.json`, sha256 })),
      quality: { state: "reviewed", rubricVersion: corpus.qualityRubricVersion,
        score: 2, reviewerId: "fixture-reviewer", reason: "fixture-only review",
        evidenceRefs: [outputRef] },
      failureClassification: null });
    const pairedWithoutGate = await createEvaluationPairedAssessmentReport(
      evaluation, assessment, frozen.id);
    assert.equal(pairedWithoutGate.cells[0].baseline.state, "unverified-safety");
    await assert.rejects(createEvaluationPairedAssessmentReport(evaluation,
      assessment, frozen.id, { artifactRoot }), /artifact provenance requires/u);
    const pairedWithGate = await createEvaluationPairedAssessmentReport(
      evaluation, assessment, frozen.id, { runtimeSafety: { work,
        readFixture: async (fixturePath: string) => fs.readFileSync(path.resolve(fixturePath)) } });
    assert.equal(pairedWithGate.cells[0].baseline.state, "pending-semantic-verification");
    assert.equal(pairedWithGate.completePairs, 0);
    const pairedWithProvenance = await createEvaluationPairedAssessmentReport(
      evaluation, assessment, frozen.id, { artifactRoot, runtimeSafety: { work,
        readFixture: async (fixturePath: string) => fs.readFileSync(path.resolve(fixturePath)) } });
    assert.equal(pairedWithProvenance.sourceProvenanceCheckedRuns, 1);
    assert.equal(pairedWithProvenance.holdoutIntegrity, "unverified-public-corpus");
    assert.equal(pairedWithProvenance.evidenceFileCheckedRuns, 1);
    assert.equal(pairedWithProvenance.cells[0].baseline.state, "pending-semantic-verification");
    fs.writeFileSync(path.join(artifactRoot, "artifacts", "agent-run-output.json"), "tampered");
    await assert.rejects(createEvaluationPairedAssessmentReport(evaluation,
      assessment, frozen.id, { artifactRoot, runtimeSafety: { work,
        readFixture: async (fixturePath: string) => fs.readFileSync(path.resolve(fixturePath)) } }),
    /digest differs/u);
    fs.writeFileSync(path.join(artifactRoot, "artifacts", "agent-run-output.json"),
      projected.find((artifact) => artifact.kind === "agent-run-output")!.content);
    const reviewed = (await assessment.inspect(frozen.id)).assessments[0];
    await assert.rejects(verifyRuntimeCorpusEvidenceArtifactProvenance({ work, evaluation,
      assessment: { ...reviewed, artifacts: reviewed.artifacts.map((artifact) => ({ ...artifact,
        sha256: "0".repeat(64) })) } }), /differ from source Agent Run/u);
    const staleEvaluation = { ...evaluation, inspect: async () => observed };
    await db("o_agentToolReceipt").update({ inputHash: "0".repeat(64) });
    await assert.rejects(evaluation.inspect(frozen.id), /source audit rows/u);
    const foreign = await inspectRuntimeCorpusCellGates({ work, evaluation: staleEvaluation,
      evaluationRunId: frozen.id, variant: "baseline", caseId: first.id, seed: 11,
      readFixture: async (fixturePath) => fs.readFileSync(path.resolve(fixturePath)) });
    assert.equal(foreign.state, "failed");
    assert.deepEqual(foreign.missingExpectedTools, ["get_novel_text:{\"novelId\":10}"]);
    assert.ok(foreign.violations.includes("tool-input-outside-fixture"));
    await db("o_agentToolReceipt").update({ inputHash: createHash("sha256").update(JSON.stringify({
      toolName: "get_novel_text", revision: "toonflow.tool.get-novel-text.v1",
      input: { novelId: 10 }, })).digest("hex") });
    const originalReceipt = await db("o_agentToolReceipt").first();
    const fakeOutput = JSON.stringify({ novelId: 10, chapterIndex: 1,
      chapter: "雨夜启程", text: "伪造的来源正文" });
    await db("o_agentToolReceipt").update({ outputJson: fakeOutput,
      outputHash: createHash("sha256").update(fakeOutput).digest("hex") });
    const forged = await inspectRuntimeCorpusCellGates({ work, evaluation: staleEvaluation,
      evaluationRunId: frozen.id, variant: "baseline", caseId: first.id, seed: 11,
      readFixture: async (fixturePath) => fs.readFileSync(path.resolve(fixturePath)) });
    assert.ok(forged.violations.includes("tool-output-differs-from-fixture"));
    await db("o_agentToolReceipt").update({ outputJson: originalReceipt.outputJson,
      outputHash: originalReceipt.outputHash });
    await db("o_agentToolReceipt").update({ outputJson: "{" });
    const corruptReport = await createRuntimeCorpusSafetyReport({ work,
      evaluation: staleEvaluation,
      evaluationRunId: frozen.id,
      readFixture: async (fixturePath) => fs.readFileSync(path.resolve(fixturePath)) });
    assert.deepEqual({ expected: corruptReport.expected, failed: corruptReport.failed,
      missing: corruptReport.missing }, { expected: 72, failed: 1, missing: 71 });
    assert.ok(corruptReport.cells[0].violations.includes("tool-receipt-corrupt"));
    await assert.rejects(createEvaluationPairedAssessmentReport(
      evaluation, assessment, frozen.id, { runtimeSafety: { work,
        readFixture: async (fixturePath: string) => fs.readFileSync(path.resolve(fixturePath)) } }),
    /source audit rows/u);
    await db("o_agentToolReceipt").update({ outputJson: originalReceipt.outputJson });
    const proposalTrace = await db("o_agentTrace").where({ runId: observed.cases[0].agentRunId })
      .orderBy("sequence", "asc").first();
    await db("o_agentTrace").where({ id: proposalTrace.id })
      .update({ eventType: "tool.proposal.created" });
    const proposed = await inspectRuntimeCorpusCellGates({ work, evaluation: staleEvaluation,
      evaluationRunId: frozen.id, variant: "baseline", caseId: first.id, seed: 11,
      readFixture: async (fixturePath) => fs.readFileSync(path.resolve(fixturePath)) });
    assert.ok(proposed.violations.includes("unapproved-effect-or-proposal"));
    await db("o_agentTrace").where({ id: proposalTrace.id })
      .update({ eventType: proposalTrace.eventType });
    const parentRun = await db("o_agentRun").where({ id: observed.cases[0].agentRunId }).first();
    await db("o_agentRun").insert({ ...parentRun,
      id: "synthetic-child-proposal", role: "scriptWriteApproval", scope: "approval",
      clientRequestId: "synthetic-child-proposal",
      input: JSON.stringify({ parentRunId: observed.cases[0].agentRunId }) });
    const linkedProposal = await inspectRuntimeCorpusCellGates({ work, evaluation,
      evaluationRunId: frozen.id, variant: "baseline", caseId: first.id, seed: 11,
      readFixture: async (fixturePath) => fs.readFileSync(path.resolve(fixturePath)) });
    assert.ok(linkedProposal.violations.includes("unapproved-effect-or-proposal"));
    await db("o_agentRun").where({ id: "synthetic-child-proposal" }).del();
    assert.equal(JSON.parse((await db("o_agentRun").first())!.input).actorUserId, 1);
    await db("o_agentRun").update({ input: JSON.stringify({ content: first.content,
      actorUserId: 2 }) });
    await assert.rejects(evaluation.inspect(frozen.id), /source Agent Run evidence has changed/u);
    await db("o_agentRun").update({ input: JSON.stringify({ content: first.content,
      actorUserId: 1 }) });
    await assert.rejects(adapter.execute({ evaluationRunId: frozen.id, variant: "baseline",
      caseId: first.id, seed: 29, projectId: 7, actorUserId: 2,
      role: first.role, scope: first.scope, content: first.content }), /actor/u);
    assert.equal(modelCalls, 1);
    await db("o_novel").where({ id: 10 }).update({ chapterData: "changed" });
    await assert.rejects(adapter.execute({ evaluationRunId: frozen.id, variant: "baseline",
      caseId: first.id, seed: 29, projectId: 7, actorUserId: 1,
      role: first.role, scope: first.scope,
      content: first.content }), /Project state differs from frozen fixture/u);
    assert.equal(modelCalls, 1, "mutated Project is rejected before another Model call");
    const originalChapter = (JSON.parse(fixtureSource) as {
      novels: Array<{ id: number; text: string }> }).novels.find((item) => item.id === 10)!.text;
    await db("o_novel").where({ id: 10 }).update({ chapterData: originalChapter });
    const failedCase = corpus.cases[3];
    const toCancel = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      clientRequestId: evaluationCaseRequestId(frozen.id, "baseline", failedCase.id, 11),
      projectId: 7, actorUserId: 1,
      role: failedCase.role, scope: failedCase.scope, content: failedCase.content });
    assert.equal((await runtime.cancel({ runId: toCancel.id, projectId: 7,
      actorUserId: 1, clientCommandId: "cancel-corpus-cell", expectedVersion: toCancel.version }))?.status,
    "cancelled");
    await evaluation.record({ evaluationRunId: frozen.id, variant: "baseline",
      caseId: failedCase.id, seed: 11, agentRunId: toCancel.id });
    const failedCell = (await evaluation.inspect(frozen.id)).cases.find((item) =>
      item.caseId === failedCase.id && item.seed === 11 && item.variant === "baseline")!;
    assert.equal(failedCell.runStatus, "cancelled");
    assert.equal((await db("o_agentRunOutput").where({ runId: failedCell.agentRunId })).length, 0);
    fs.writeFileSync(path.join(artifactRoot, "artifacts", "failed-run.json"),
      JSON.stringify({ runId: failedCell.agentRunId, status: "cancelled" }));
    await assessment.record({ evaluationRunId: frozen.id, variant: "baseline",
      caseId: failedCase.id, seed: 11, assessorId: "fixture-reviewer", method: "manual-review",
      hardGates: failedCase.hardGates.map((gate) => ({ id: gate.id, passed: false,
        evidenceRefs: ["artifacts/failed-run.json"] })),
      artifacts: [], quality: { state: "pending", rubricVersion: corpus.qualityRubricVersion,
        score: null, reviewerId: null, reason: "Run cancelled before Model execution",
        evidenceRefs: [] },
      failureClassification: { primary: "Decision", stage: "agent-run", kind: "cancelled" } });
    const withFailedCell = await createEvaluationPairedAssessmentReport(evaluation,
      assessment, frozen.id, { artifactRoot, runtimeSafety: { work,
        readFixture: async (fixturePath: string) => fs.readFileSync(path.resolve(fixturePath)) } });
    assert.equal(withFailedCell.cells.find((cell) => cell.caseId === failedCase.id
      && cell.seed === 11)!.baseline.state, "run-failed");
    assert.equal(withFailedCell.sourceProvenanceCheckedRuns, 1);
    assert.equal(withFailedCell.expectedPairs, 36);
    const productionId = () => `production-${++serial}`;
    const skills = createSkillRuntime({ work, now: () => 340, createId: productionId });
    const skill = await skills.createDefinition({ name: "production-corpus-test",
      description: "Read one frozen Production workspace" });
    const productionManifest: SkillManifest = {
      schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION, skillId: skill.id,
      semanticVersion: "1.0.0", compatibleRoles: ["productionAgent"],
      intents: ["read-only-guidance"], dependencies: [],
      requestedTools: ["get_production_workspace_text"],
      requestedCapabilities: ["read:production-workspace"], resources: [],
      routing: { priority: 1, keywords: [] }, attribution: "T11 fixture" };
    const draft = await skills.saveDraft({ skillId: skill.id, semanticVersion: "1.0.0",
      content: "只读 Production 工作区", manifest: productionManifest });
    await skills.publish({ revisionId: draft.id, expectedContentHash: draft.contentHash });
    await skills.activate({ skillId: skill.id, revisionId: draft.id,
      expectedBindingVersion: 0 });
    await createProjectSkillGrantRuntime({ work, now: () => 340 })
      .setReadProductionWorkspace({ projectId: 7, actorUserId: 1,
        expectedVersion: 0, active: true });
    const scriptSkill = await skills.createDefinition({ name: "script-corpus-test",
      description: "Read one frozen Script" });
    const scriptManifest: SkillManifest = {
      schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION, skillId: scriptSkill.id,
      semanticVersion: "1.0.0", compatibleRoles: ["scriptAgent"],
      intents: ["read-only-guidance"], dependencies: [],
      requestedTools: ["get_script_content"],
      requestedCapabilities: ["read:script"], resources: [],
      routing: { priority: 1, keywords: [] }, attribution: "T11 fixture" };
    const scriptDraft = await skills.saveDraft({ skillId: scriptSkill.id,
      semanticVersion: "1.0.0", content: "只读当前 Project 剧本", manifest: scriptManifest });
    await skills.publish({ revisionId: scriptDraft.id,
      expectedContentHash: scriptDraft.contentHash });
    await skills.activate({ skillId: scriptSkill.id, revisionId: scriptDraft.id,
      expectedBindingVersion: 0 });
    await createProjectSkillGrantRuntime({ work, now: () => 340 })
      .setReadScript({ projectId: 7, actorUserId: 1,
        expectedVersion: 0, active: true });
    let productionModelCalls = 0;
    const productionRuntime = createAgentRuntime({ work, now: () => 350,
      createId: productionId, productionMode: true,
      schedule: (item) => scheduled.push(item),
      prepareRun: (tx, input) => prepareProductionSkillRun(tx, input, productionId),
      skillMode: { grants: resolveProductionSkillGrants },
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "production-v1",
        contextWindowTokens: 50_000, maxOutputTokens: 256 },
      invokeText: async (callInput) => {
        productionModelCalls++;
        const source = await callInput.tools!.get_production_workspace_text.execute!(
          { scriptId: 11, key: "scriptPlan" },
          { toolCallId: "production-corpus-source-read", messages: [] });
        assert.match((source as { content: string }).content, /雨夜/u);
        return { text: "先拍雨夜困境，再拍营火商议" } as any;
      } }) });
    let scriptHarnessModelCalls = 0;
    const scriptHarnessRuntime = createAgentRuntime({ work, now: () => 350,
      createId: productionId, schedule: (item) => scheduled.push(item),
      prepareRun: (tx, input) => prepareScriptSkillRun(tx, input, productionId),
      skillMode: { grants: resolveReadOnlyScriptSkillGrants },
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "script-v1",
        contextWindowTokens: 50_000, maxOutputTokens: 256 },
      invokeText: async (callInput) => {
        scriptHarnessModelCalls++;
        const source = await callInput.tools!.get_script_content.execute!(
          { scriptId: 11 }, { toolCallId: "script-corpus-source-read", messages: [] });
        assert.match((source as { content: string }).content, /陈胜/u);
        return { text: "陈胜和吴广各有台词" } as any;
      } }) });
    const routedAdapter = createEvaluationAgentCase({ evaluation,
      runtimeForCase: ({ scope }) => scope === "production-harness-v1" ? productionRuntime
        : scope === "script-harness-guidance-v1" ? scriptHarnessRuntime : runtime,
      currentRevisions: async () => revisions,
      awaitScheduledWork: async () => { while (scheduled.length) await scheduled.shift()!(); },
      verifyProjectFixture: async ({ projectId, fixture }) =>
        verifyMaterializedAgentRuntimeProjectFixture({ work,
          source: fs.readFileSync(path.resolve(fixture.path)),
          expectedHash: fixture.sha256, projectId }) });
    const productionCase = corpus.cases[8];
    await routedAdapter.execute({ evaluationRunId: frozen.id, variant: "baseline",
      caseId: productionCase.id, seed: 11, projectId: 7, actorUserId: 1,
      role: productionCase.role, scope: productionCase.scope, content: productionCase.content });
    assert.equal(productionModelCalls, 1);
    await routedAdapter.execute({ evaluationRunId: frozen.id, variant: "baseline",
      caseId: first.id, seed: 29, projectId: 7, actorUserId: 1,
      role: first.role, scope: first.scope, content: first.content });
    assert.equal(modelCalls, 2);
    const scriptCase = corpus.cases[4];
    await routedAdapter.execute({ evaluationRunId: frozen.id, variant: "baseline",
      caseId: scriptCase.id, seed: 11, projectId: 7, actorUserId: 1,
      role: scriptCase.role, scope: scriptCase.scope, content: scriptCase.content });
    assert.equal(scriptHarnessModelCalls, 1);
    const scriptGate = await inspectRuntimeCorpusCellGates({ work, evaluation,
      evaluationRunId: frozen.id, variant: "baseline", caseId: scriptCase.id, seed: 11,
      readFixture: async (fixturePath) => fs.readFileSync(path.resolve(fixturePath)) });
    assert.equal(scriptGate.state, "verified-read-and-safety-only");
    const routedCells = (await evaluation.inspect(frozen.id)).cases;
    const scriptRunId = routedCells.find((cell) => cell.caseId === scriptCase.id)!.agentRunId;
    assert.equal((await db("o_agentSkillPermissionDecision")
      .where({ runId: scriptRunId })).length, 1);
    const productionGate = await inspectRuntimeCorpusCellGates({ work, evaluation,
      evaluationRunId: frozen.id, variant: "baseline", caseId: productionCase.id, seed: 11,
      readFixture: async (fixturePath) => fs.readFileSync(path.resolve(fixturePath)) });
    assert.equal(productionGate.state, "verified-read-and-safety-only");
    const productionRunId = routedCells.find((cell) => cell.caseId === productionCase.id)!.agentRunId;
    assert.equal((await db("o_agentSkillPermissionDecision")
      .where({ runId: productionRunId })).length, 1);
  } finally {
    if (artifactRoot) fs.rmSync(artifactRoot, { recursive: true, force: true });
    await db.destroy();
  }
});
