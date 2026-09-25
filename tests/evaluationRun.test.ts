import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";
import type { Knex } from "knex";

import { createEvaluationRunRuntime, evaluationCaseRequestId, hashEvaluationInput,
  validateEvaluationRunManifest } from "../src/eval/evaluationRun";
import initDB from "../src/lib/initDB";

const manifest = { schemaVersion: "toonflow.evaluation-run.v2",
  studyId: "t11-paired-v1", caseManifestHash: "a".repeat(64),
  caseIds: ["DEV-EXT-001"], seeds: [11, 29],
  caseInputs: [{ caseId: "DEV-EXT-001", projectId: 7, contentHash: hashEvaluationInput("给出项目摘要"),
    role: "scriptAgent", scope: "read-only-project-guidance-v1" }],
  variants: ["baseline", "candidate"],
  baseline: { app: "app-1", schema: "schema-1", runtime: "runtime-1",
    tool: "tool-1", context: "context-1", memory: "memory-1",
    skill: "skill-1", model: "model-1", vendor: "vendor-1" },
  candidate: { app: "app-2", schema: "schema-1", runtime: "runtime-2",
    tool: "tool-2", context: "context-2", memory: "memory-1",
    skill: "skill-2", model: "model-1", vendor: "vendor-1" }, frozenAt: 100 };

async function initializeQuietly(db: Knex) {
  const previous = console.log;
  console.log = () => {};
  try { await initDB(db); } finally { console.log = previous; }
}

async function fixture() {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_agentEvaluationRun", (t) => {
    t.text("id").primary(); t.text("schemaVersion"); t.text("manifestJson");
    t.text("manifestHash"); t.integer("createdAt");
  });
  await db.schema.createTable("o_agentEvaluationCase", (t) => {
    t.text("id").primary(); t.text("evaluationRunId"); t.text("caseId");
    t.integer("seed"); t.text("variant"); t.text("agentRunId");
    t.text("evidenceJson"); t.text("evidenceHash"); t.integer("createdAt");
    t.unique(["evaluationRunId", "caseId", "seed", "variant"]);
    t.unique(["evaluationRunId", "agentRunId"]);
  });
  await db.schema.createTable("o_agentRun", (t) => {
    t.text("id").primary(); t.integer("projectId"); t.text("status"); t.integer("version");
    t.text("clientRequestId"); t.text("role"); t.text("scope"); t.text("input");
    t.integer("createdAt"); t.integer("completedAt");
  });
  await db.schema.createTable("o_agentRunOutput", (t) => {
    t.text("runId"); t.text("contentHash");
  });
  await db.schema.createTable("o_agentTrace", (t) => {
    t.text("id").primary(); t.text("runId"); t.integer("sequence");
    t.text("predecessorTraceId");
  });
  let counter = 0;
  const runtime = createEvaluationRunRuntime({ work: async (operation) => operation(db),
    now: () => 200, createId: () => `eval-${++counter}` });
  return { db, runtime };
}

test("T11 manifest freezes a unique paired case/seed matrix and revisions", () => {
  assert.equal(validateEvaluationRunManifest(manifest).caseIds.length, 1);
  assert.throws(() => validateEvaluationRunManifest({ ...manifest, seeds: [11, 11] }));
  assert.throws(() => validateEvaluationRunManifest({ ...manifest,
    caseInputs: [{ caseId: "HOLD-EXT-001", projectId: 7, contentHash: hashEvaluationInput("x"),
      role: "scriptAgent", scope: "read-only-project-guidance-v1" }] }));
  assert.throws(() => validateEvaluationRunManifest({ ...manifest,
    candidate: { ...manifest.candidate, skill: "" } }));
  assert.throws(() => validateEvaluationRunManifest({ ...manifest,
    candidate: { ...manifest.candidate, model: "model-2" } }), /common environment/u);
  assert.throws(() => validateEvaluationRunManifest({ ...manifest,
    candidate: { ...manifest.candidate, schema: "schema-2" } }), /common environment/u);
  assert.throws(() => validateEvaluationRunManifest({ ...manifest,
    caseInputs: [{ ...manifest.caseInputs[0], projectId: 0 }] }));
});

test("T11 case evidence must link a terminal production Agent Run and is idempotent", async () => {
  const { db, runtime } = await fixture();
  try {
    const created = await runtime.create(manifest);
    await db("o_agentRun").insert({ id: "run-1", projectId: 7,
      status: "succeeded", version: 3,
      createdAt: 110, completedAt: 150,
      role: "scriptAgent", scope: "read-only-project-guidance-v1",
      input: JSON.stringify({ content: "给出项目摘要" }),
      clientRequestId: evaluationCaseRequestId(created.id, "candidate", "DEV-EXT-001", 11) });
    await db("o_agentRunOutput").insert({ runId: "run-1", contentHash: "b".repeat(64) });
    await db("o_agentTrace").insert({ id: "trace-1", runId: "run-1", sequence: 1 });
    const input = { evaluationRunId: created.id, caseId: "DEV-EXT-001",
      seed: 11, variant: "candidate" as const, agentRunId: "run-1" };
    const recorded = await runtime.record(input);
    assert.equal(recorded.outputHash, "b".repeat(64));
    assert.equal(recorded.lastTraceSequence, 1);
    assert.equal(recorded.elapsedMs, 40);
    assert.equal(recorded.costMicros, null);
    assert.deepEqual(await runtime.record(input), recorded);
    assert.equal((await db("o_agentEvaluationCase")).length, 1);
    const inspected = await runtime.inspect(created.id);
    assert.equal(inspected.expected, 4);
    assert.equal(inspected.recorded, 1);
    assert.deepEqual(inspected.missing, ["baseline:DEV-EXT-001:11",
      "baseline:DEV-EXT-001:29", "candidate:DEV-EXT-001:29"]);
    await db("o_agentRun").where({ id: "run-1" }).update({ version: 4 });
    await assert.rejects(runtime.inspect(created.id), /evidence has changed/u);
    await db("o_agentRun").where({ id: "run-1" }).update({ version: 3 });
    await db("o_agentRun").where({ id: "run-1" }).update({ completedAt: 151 });
    await assert.rejects(runtime.inspect(created.id), /evidence has changed/u);
    await db("o_agentRun").where({ id: "run-1" }).update({ completedAt: 150 });
    await db("o_agentRun").where({ id: "run-1" }).update({ projectId: 8 });
    await assert.rejects(runtime.inspect(created.id), /evidence has changed/u);
    await assert.rejects(runtime.record(input), /frozen case/u);
    await db("o_agentRun").where({ id: "run-1" }).update({ projectId: 7 });
    await db("o_agentRun").where({ id: "run-1" }).update({ input: JSON.stringify({ content: "换了输入" }) });
    await assert.rejects(runtime.inspect(created.id), /evidence has changed/u);
    await assert.rejects(runtime.record(input), /frozen case/u);
    await db("o_agentRun").where({ id: "run-1" }).update({ input: JSON.stringify({ content: "给出项目摘要" }) });
    await db("o_agentTrace").insert({ id: "trace-2", runId: "run-1",
      sequence: 2, predecessorTraceId: "wrong" });
    await assert.rejects(runtime.inspect(created.id), /evidence has changed/u);
    await assert.rejects(runtime.record(input), /lacks valid Agent Run evidence/u);
    await db("o_agentTrace").where({ id: "trace-2" }).delete();
    await assert.rejects(runtime.record({ ...input, seed: 29 }), /request identity/u);
    await assert.rejects(runtime.record({ ...input, caseId: "HOLD-EXT-001" }), /frozen matrix/u);
    await db("o_agentEvaluationCase").where({ caseId: input.caseId }).update({ evidenceHash: "c".repeat(64) });
    await assert.rejects(runtime.record(input), /corrupt evidence/u);
  } finally { await db.destroy(); }
});

test("T11 rejects queued or trace-less Agent Runs before recording a case", async () => {
  const { db, runtime } = await fixture();
  try {
    const created = await runtime.create(manifest);
    const input = { evaluationRunId: created.id, caseId: "DEV-EXT-001",
      seed: 11, variant: "baseline" as const, agentRunId: "run-queued" };
    await db("o_agentRun").insert({ id: "run-queued", projectId: 7,
      status: "queued", version: 1,
      createdAt: 110, completedAt: null,
      role: "scriptAgent", scope: "read-only-project-guidance-v1",
      input: JSON.stringify({ content: "给出项目摘要" }),
      clientRequestId: evaluationCaseRequestId(created.id, "baseline", "DEV-EXT-001", 11) });
    await assert.rejects(runtime.record(input), /terminal production Agent Run/u);
    await db("o_agentRun").where({ id: "run-queued" }).update({ status: "failed" });
    await assert.rejects(runtime.record(input), /valid production Run timing/u);
    await db("o_agentRun").where({ id: "run-queued" }).update({ completedAt: 150 });
    await assert.rejects(runtime.record(input), /lacks valid Agent Run evidence/u);
    await db("o_agentTrace").insert({ id: "trace-queued", runId: "run-queued", sequence: 1 });
    await db("o_agentRun").where({ id: "run-queued" }).update({ projectId: 8 });
    await assert.rejects(runtime.record(input), /frozen case/u);
    await db("o_agentRun").where({ id: "run-queued" }).update({ projectId: 7 });
    await db("o_agentRun").where({ id: "run-queued" }).update({ clientRequestId: "unrelated-request" });
    await assert.rejects(runtime.record(input), /request identity/u);
  } finally { await db.destroy(); }
});

test("T11 fresh schema contains immutable Evaluation Run evidence tables", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await initializeQuietly(db);
    assert.equal(await db.schema.hasTable("o_agentEvaluationRun"), true);
    assert.equal(await db.schema.hasTable("o_agentEvaluationCase"), true);
    await db("o_agentEvaluationRun").insert({ id: "eval-1", schemaVersion: "v1",
      manifestJson: "{}", manifestHash: "a".repeat(64), createdAt: 100 });
    await assert.rejects(db("o_agentEvaluationRun").where({ id: "eval-1" })
      .update({ manifestJson: "changed" }), /immutable/u);
  } finally { await db.destroy(); }
});

test("T11 upgrading an existing database adds Evaluation tables without deleting Project data", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.schema.createTable("o_project", (t) => { t.integer("id").primary(); t.integer("userId"); });
    await db("o_project").insert({ id: 7, userId: 1 });
    await initializeQuietly(db);
    assert.equal(await db.schema.hasTable("o_agentEvaluationRun"), true);
    assert.equal((await db("o_project").where({ id: 7 }).first()).userId, 1);
  } finally { await db.destroy(); }
});
