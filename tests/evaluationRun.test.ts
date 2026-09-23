import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

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
