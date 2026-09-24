import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import { createAgentRuntime, type AgentRunDependencies } from "../src/agentRuntime";
import { createEvaluationCaseObservationStore } from "../src/eval/evaluationCaseObservation";
import { createEvaluationCoverageReport, renderEvaluationCoverageMarkdown } from "../src/eval/evaluationCoverageReport";
import { assertComparableEvaluationContracts } from "../src/eval/evaluationComparisonContract";
import { createEvaluationRunStore, EVALUATION_REVISION_CONTRACT_SCHEMA_VERSION,
  type EvaluationRevisionContract } from "../src/eval/evaluationRun";
import initDB from "../src/lib/initDB";

const manifestSource = fs.readFileSync(path.join(process.cwd(), "data/eval/agent-harness-golden-v1/manifest.json"), "utf8");
const revisions: EvaluationRevisionContract = {
  schemaVersion: EVALUATION_REVISION_CONTRACT_SCHEMA_VERSION,
  runtimeRevision: "toonflow.agent-run.start.v1",
  toolRevisionHash: "a".repeat(64),
  contextRevision: "context-bundle.v1",
  skillRevisionHash: "b".repeat(64),
  modelRevision: "fake-model.v1",
  vendorRevision: "fake-vendor.v1",
  evaluationSchemaVersion: "toonflow.golden-eval-result.v1",
  rubricRevision: "production-quality@1.0.0",
};

async function database(): Promise<Knex> {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.raw("PRAGMA foreign_keys = OFF");
  await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
  const originalLog = console.log;
  console.log = () => undefined;
  try { await initDB(db); } finally { console.log = originalLog; }
  return db;
}

function store(db: Knex, id = "eval-1") {
  return createEvaluationRunStore({ work: async (operation) => operation(db), now: () => 100,
    createId: () => id });
}

test("Evaluation Run freezes all 18 cases and revisions without fabricating results", async () => {
  const db = await database();
  try {
    const frozen = await store(db).freeze({ manifestSource, revisions });
    assert.equal(frozen.caseCount, 18);
    assert.equal(frozen.status, "pending");
    const run = await db("o_evaluationRun").where({ id: frozen.id }).first();
    assert.equal(run.manifestHash, frozen.manifestHash);
    assert.equal(run.revisionContractHash, frozen.revisionContractHash);
    assert.deepEqual(JSON.parse(run.revisionContractJson), revisions);
    const cases = await db("o_evaluationCase").where({ evaluationRunId: frozen.id });
    assert.equal(cases.length, 18);
    assert.ok(cases.every((entry) => entry.status === "pending" && entry.agentRunId == null
      && entry.hardGateResultsJson == null && entry.qualityReviewJson == null));
    await assert.rejects(db("o_evaluationRun").where({ id: frozen.id }).update({ manifestHash: "changed" }),
      /Evaluation Run contract is immutable/);
    await assert.rejects(db("o_evaluationRun").where({ id: frozen.id }).delete(),
      /Evaluation Run evidence cannot be deleted/);
    await assert.rejects(db("o_evaluationCase").where({ evaluationRunId: frozen.id }).first()
      .then((entry) => db("o_evaluationCase").where({ id: entry.id }).update({ caseId: "forged" })),
    /Evaluation Case identity is immutable/);
  } finally { await db.destroy(); }
});

test("Evaluation freeze rejects changed rubric and rolls back a failed case insert", async () => {
  const db = await database();
  try {
    await assert.rejects(store(db).freeze({ manifestSource, revisions: { ...revisions, rubricRevision: "wrong" } }),
      /rubric revision differs/);
    assert.equal((await db("o_evaluationRun")).length, 0);
    await db.raw(`CREATE TRIGGER reject_eval_case BEFORE INSERT ON o_evaluationCase
      BEGIN SELECT RAISE(ABORT, 'injected case failure'); END`);
    await assert.rejects(store(db).freeze({ manifestSource, revisions }), /injected case failure/);
    assert.equal((await db("o_evaluationRun")).length, 0);
    assert.equal((await db("o_evaluationCase")).length, 0);
  } finally { await db.destroy(); }
});

test("Evaluation manifest identity ignores Windows line endings while retaining exact case count", async () => {
  const db = await database();
  try {
    const first = await store(db, "eval-lf").freeze({ manifestSource, revisions });
    const second = await store(db, "eval-crlf").freeze({
      manifestSource: manifestSource.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"), revisions,
    });
    assert.equal(first.manifestHash, second.manifestHash);
    assert.equal((await db("o_evaluationCase")).length, 36);
  } finally { await db.destroy(); }
});

test("existing Project data survives creation of the new Evaluation tables", async () => {
  const db = await database();
  try {
    await db("o_project").insert({ id: 77, userId: 1 });
    await db.schema.dropTable("o_evaluationCase");
    await db.schema.dropTable("o_evaluationRun");
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    assert.equal((await db("o_project").where({ id: 77 }).first()).userId, 1);
    assert.equal(await db.schema.hasTable("o_evaluationRun"), true);
    assert.equal(await db.schema.hasTable("o_evaluationCase"), true);
  } finally { await db.destroy(); }
});

test("a Case observation requires a linked production Agent Run, not a direct evaluator result", async () => {
  const db = await database();
  try {
    const frozen = await store(db).freeze({ manifestSource, revisions });
    await db("o_project").insert({ id: 7, userId: 1, name: "测试 Project" });
    const queue: Array<() => Promise<void>> = [];
    let serial = 0;
    const dependencies: AgentRunDependencies = {
      work: async (operation) => operation(db), now: () => 200 + serial,
      createId: () => `agent-${++serial}`, schedule: (work) => queue.push(work),
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "text-v1" },
        invokeText: async () => ({ text: "可核验的只读建议" }) } as any),
    };
    const runtime = createAgentRuntime(dependencies);
    const observer = createEvaluationCaseObservationStore(async (operation) => operation(db), () => 500);
    const input = { evaluationRunId: frozen.id, caseId: "DEV-EXT-001" };
    await assert.rejects(observer.attach({ ...input, agentRunId: "missing" }), /observable production Agent Run/);
    const agentRun = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: `eval:${frozen.id}:${input.caseId}`, content: "请核对测试 Project 的事实" });
    await assert.rejects(observer.attach({ ...input, agentRunId: agentRun.id }), /observable production Agent Run/);
    while (queue.length) await queue.shift()!();
    await assert.rejects(observer.attach({ evaluationRunId: frozen.id, caseId: "DEV-EXT-002",
      agentRunId: agentRun.id }), /observable production Agent Run/);
    const observation = await observer.attach({ ...input, agentRunId: agentRun.id });
    assert.equal(observation.agentRunStatus, "succeeded");
    assert.ok(observation.agentRunTraceSequence >= 2);
    const saved = await db("o_evaluationCase").where({ evaluationRunId: frozen.id, caseId: input.caseId }).first();
    assert.equal(saved.status, "observed");
    assert.equal(saved.agentRunId, agentRun.id);
    assert.equal(saved.elapsedMs, observation.elapsedMs);
    assert.ok(observation.elapsedMs !== null && observation.elapsedMs >= 0);
    assert.equal(saved.costMicros, null, "an unknown charge must not be recorded as zero");
    assert.equal(saved.hardGateResultsJson, null, "observation is not a score");
    assert.equal(saved.completedAt, null, "observation is not case completion");
    assert.equal(saved.observedAt, observation.observedAt);
    await assert.rejects(observer.attach({ ...input, agentRunId: agentRun.id }), /pending Case is unavailable/);
    const secondRun = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: `eval:${frozen.id}:DEV-EXT-002`, content: "核对第二个案例" });
    while (queue.length) await queue.shift()!();
    const originalCompletedAt = (await db("o_agentRun").where({ id: secondRun.id }).first()).completedAt;
    await db("o_agentRun").where({ id: secondRun.id }).update({ completedAt: null });
    await assert.rejects(observer.attach({ evaluationRunId: frozen.id, caseId: "DEV-EXT-002",
      agentRunId: secondRun.id }), /valid end-to-end timing/);
    await db("o_agentRun").where({ id: secondRun.id }).update({ completedAt: originalCompletedAt });
    await db("o_agentTrace").where({ runId: secondRun.id, sequence: 2 }).update({ predecessorTraceId: "wrong" });
    await assert.rejects(observer.attach({ evaluationRunId: frozen.id, caseId: "DEV-EXT-002",
      agentRunId: secondRun.id }), /intact causal Trace/);
  } finally { await db.destroy(); }
});

test("pairing requires intact matching manifests and scoring contracts, while naming treatment changes", async () => {
  const db = await database();
  try {
    await store(db, "baseline").freeze({ manifestSource, revisions });
    await store(db, "candidate").freeze({ manifestSource,
      revisions: { ...revisions, runtimeRevision: "agent-runtime.v2", modelRevision: "fake-model.v2" } });
    const baseline = await db("o_evaluationRun").where({ id: "baseline" }).first();
    const candidate = await db("o_evaluationRun").where({ id: "candidate" }).first();
    const compatible = assertComparableEvaluationContracts(baseline, candidate);
    assert.deepEqual(compatible.changedTreatmentRevisions, ["runtimeRevision", "modelRevision"]);
    assert.equal(compatible.manifestHash, baseline.manifestHash);
    assert.throws(() => assertComparableEvaluationContracts(baseline, baseline), /two distinct Runs/);
    assert.throws(() => assertComparableEvaluationContracts(baseline, { ...candidate, manifestHash: "0".repeat(64) }),
      /corrupt or unsupported/);
    assert.throws(() => assertComparableEvaluationContracts(baseline,
      { ...candidate, manifestJson: candidate.manifestJson.replace("DEV-EXT-001", "DEV-EXT-009") }),
    /corrupt or unsupported/);
    const incompatibleRevisions = { ...JSON.parse(candidate.revisionContractJson),
      evaluationSchemaVersion: "toonflow.golden-eval-result.v2" };
    const altered = JSON.stringify(incompatibleRevisions);
    const { createHash } = await import("node:crypto");
    assert.throws(() => assertComparableEvaluationContracts(baseline, { ...candidate,
      revisionContractJson: altered,
      revisionContractHash: createHash("sha256").update(altered).digest("hex") }), /incompatible/);
  } finally { await db.destroy(); }
});

test("paired coverage reports all 18 cases without inventing hard-gate or quality scores", async () => {
  const db = await database();
  try {
    await store(db, "baseline").freeze({ manifestSource, revisions });
    await store(db, "candidate").freeze({ manifestSource,
      revisions: { ...revisions, runtimeRevision: "agent-runtime.v2" } });
    const reporter = createEvaluationCoverageReport(async (operation) => operation(db));
    const before = await reporter.compare({ baselineRunId: "baseline", candidateRunId: "candidate" });
    assert.equal(before.defined, 18);
    assert.deepEqual(before.baseline, { pending: 18, observed: 0, missingRecord: 0, invalidRecord: 0 });
    assert.deepEqual(before.candidate, before.baseline);
    assert.deepEqual(before.changedTreatmentRevisions, ["runtimeRevision"]);
    assert.equal("qualityScore" in before, false);
    await db("o_project").insert({ id: 7, userId: 1, name: "评测 Project" });
    const queue: Array<() => Promise<void>> = [];
    let serial = 0;
    const runtime = createAgentRuntime({ work: async (operation) => operation(db),
      now: () => 200 + serial, createId: () => `coverage-${++serial}`,
      schedule: (work) => queue.push(work),
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "text-v1" },
        invokeText: async () => ({ text: "可核验的只读建议" }) } as any) });
    const agentRun = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "eval:candidate:DEV-EXT-001", content: "核对评测 Project" });
    while (queue.length) await queue.shift()!();
    await createEvaluationCaseObservationStore(async (operation) => operation(db), () => 500)
      .attach({ evaluationRunId: "candidate", caseId: "DEV-EXT-001", agentRunId: agentRun.id });
    const after = await reporter.compare({ baselineRunId: "baseline", candidateRunId: "candidate" });
    assert.deepEqual(after.candidate, { pending: 17, observed: 1, missingRecord: 0, invalidRecord: 0 });
    assert.equal(after.cases.find((entry) => entry.id === "DEV-EXT-001")?.candidate, "observed");
    const markdown = renderEvaluationCoverageMarkdown(after);
    assert.match(markdown, /Defined cases: 18/);
    assert.match(markdown, /DEV-EXT-001.*pending.*observed/);
    assert.match(markdown, /no hard-gate or human quality result/);
    await db("o_evaluationCase").where({ evaluationRunId: "candidate", caseId: "DEV-EXT-002" })
      .update({ status: "completed" });
    const invalid = await reporter.compare({ baselineRunId: "baseline", candidateRunId: "candidate" });
    assert.equal(invalid.candidate.invalidRecord, 1,
      "an unsupported completed status without evidence cannot count as a result");
    await db("o_agentRun").where({ id: agentRun.id }).update({ clientRequestId: "unrelated-request" });
    const detached = await reporter.compare({ baselineRunId: "baseline", candidateRunId: "candidate" });
    assert.equal(detached.candidate.invalidRecord, 2,
      "an observed marker detached from its production Run identity cannot count as coverage");
  } finally { await db.destroy(); }
});
