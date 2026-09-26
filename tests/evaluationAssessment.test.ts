import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import knexFactory from "knex";

import { createEvaluationAssessmentLedger } from "../src/eval/evaluationAssessment";
import type { createEvaluationRunRuntime } from "../src/eval/evaluationRun";
import initDB from "../src/lib/initDB";

const goldenManifestJson = fs.readFileSync(path.join(process.cwd(),
  "data/eval/agent-harness-golden-v1/manifest.json"), "utf8");
const golden = JSON.parse(goldenManifestJson);

test("T11 assessment persists one reviewed result only for an observed Golden production Run", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  const originalLog = console.log;
  console.log = () => undefined;
  try { await initDB(db); } finally { console.log = originalLog; }
  try {
    await db("o_agentEvaluationRun").insert({ id: "evaluation-1",
      schemaVersion: "toonflow.evaluation-run.v2", manifestJson: "{}",
      manifestHash: "a".repeat(64), createdAt: 100 });
    const source = { caseId: "DEV-EXT-001", seed: 11, variant: "candidate" as const,
      agentRunId: "production-run-1", projectId: 7, runVersion: 3,
      runStatus: "succeeded" as const, runCreatedAt: 100, runCompletedAt: 150,
      elapsedMs: 50, costMicros: null, outputHash: "a".repeat(64),
      lastTraceId: "trace-1", lastTraceSequence: 2 };
    const observed = { manifest: { goldenManifestJson,
      variants: ["baseline", "candidate"], seeds: [11, 29] }, cases: [source] };
    const evaluation = { inspect: async () => observed } as unknown as
      ReturnType<typeof createEvaluationRunRuntime>;
    let clock = 200;
    let serial = 0;
    const ledger = createEvaluationAssessmentLedger({
      work: async (operation) => operation(db), evaluation,
      now: () => clock++, createId: () => `assessment-${++serial}` });
    const result = { evaluationRunId: "evaluation-1", caseId: source.caseId,
      seed: source.seed, variant: source.variant, assessorId: "reviewer-1",
      method: "manual-review" as const,
      hardGates: golden.cases[0].hardGates.map((gate: { id: string }) =>
        ({ id: gate.id, passed: true, evidenceRefs: ["docs/reports/verified-gate.md"] })),
      artifacts: [{ kind: "modelCallCount", ref: "artifacts/model-count.json",
        sha256: "b".repeat(64) }],
      quality: { state: "reviewed" as const, rubricVersion: golden.qualityRubricVersion,
        score: 2 as const, reviewerId: "reviewer-1", reason: "逐项人工核对",
        evidenceRefs: ["docs/reports/review.md"] },
      failureClassification: null };
    await assert.rejects(ledger.record({ ...result,
      hardGates: result.hardGates.slice(1) }), /frozen gates/u);
    await assert.rejects(ledger.record({ ...result, variant: "baseline" }), /observed frozen cell/u);
    await assert.rejects(ledger.record({ ...result,
      quality: { ...result.quality, score: 3 as any } }));
    await assert.rejects(ledger.record({ ...result,
      quality: { ...result.quality, evidenceRefs: [] } }));
    assert.equal((await db("o_agentEvaluationAssessment")).length, 0);
    const recorded = await ledger.record(result);
    assert.equal(recorded.sourceEvidenceHash.length, 64);
    assert.equal(recorded.quality.score, 2);
    assert.deepEqual(await ledger.record(result), recorded, "repeat review is idempotent despite a later clock");
    assert.equal((await db("o_agentEvaluationAssessment")).length, 1);
    const inspected = await ledger.inspect("evaluation-1");
    assert.equal(inspected.expected, 72);
    assert.equal(inspected.assessed, 1);
    assert.equal(inspected.pending.length, 71);
    await assert.rejects(ledger.record({ ...result, assessorId: "reviewer-2" }), /already recorded/u);
    await assert.rejects(db("o_agentEvaluationAssessment").update({ assessmentHash: "c".repeat(64) }),
      /immutable/u);
    observed.cases[0].runVersion = 4;
    await assert.rejects(ledger.inspect("evaluation-1"), /frozen source evidence/u);
  } finally { await db.destroy(); }
});
