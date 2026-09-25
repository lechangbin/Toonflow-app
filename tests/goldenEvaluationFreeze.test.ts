import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime } from "../src/agentRuntime";
import { createEvaluationAssessmentQueue } from "../src/eval/evaluationAssessmentQueue";
import { createEvaluationCoverageReport, renderEvaluationCoverageMarkdown } from "../src/eval/evaluationCoverageReport";
import { createEvaluationAgentCase } from "../src/eval/evaluationAgentCase";
import { createEvaluationRunRuntime } from "../src/eval/evaluationRun";
import { freezeGoldenEvaluationRun } from "../src/eval/goldenEvaluationFreeze";
import initDB from "../src/lib/initDB";

const manifestSource = fs.readFileSync(path.join(process.cwd(),
  "data/eval/agent-harness-golden-v1/manifest.json"), "utf8");
const golden = JSON.parse(manifestSource) as { cases: Array<{ id: string }> };
const revisions = { app: "app-1", schema: "schema-1", runtime: "runtime-1",
  tool: "tool-1", context: "context-1", memory: "memory-1",
  skill: "skill-1", model: "model-1", vendor: "vendor-1" };
const caseInputs = golden.cases.map(({ id }) => ({ caseId: id, projectId: 7,
  content: `核对 ${id} 的冻结场景`, role: "scriptAgent" as const,
  scope: "read-only-project-guidance-v1" as const }));

test("T11 freezes the 18 Golden definitions in one ledger without inventing execution", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  const previousLog = console.log;
  console.log = () => {};
  try { await initDB(db); } finally { console.log = previousLog; }
  try {
    let serial = 0;
    const evaluation = createEvaluationRunRuntime({ work: async (operation) => operation(db),
      now: () => 200, createId: () => `golden-${++serial}` });
    const input = { manifestSource, studyId: "golden-runtime-migration-v1",
      caseInputs, seeds: [11, 29], baseline: revisions,
      candidate: { ...revisions, app: "app-2" }, frozenAt: 100 };
    const created = await freezeGoldenEvaluationRun(evaluation, input);
    const frozen = await evaluation.inspect(created.id);
    assert.equal(frozen.manifest.caseIds.length, 18);
    assert.equal(frozen.expected, 72);
    assert.equal(frozen.recorded, 0);
    assert.equal(frozen.missing.length, 72);
    assert.equal(frozen.manifest.goldenManifestJson, manifestSource.replace(/\r\n?/gu, "\n"));
    const coverage = await createEvaluationCoverageReport(evaluation, created.id);
    assert.equal(coverage.definedCases, 18);
    assert.equal(coverage.expectedPerVariant, 36);
    assert.deepEqual(coverage.baseline, { observed: 0, missing: 36 });
    assert.deepEqual(coverage.candidate, { observed: 0, missing: 36 });
    assert.equal(coverage.cells.length, 36);
    assert.equal("qualityScore" in coverage, false);
    assert.match(renderEvaluationCoverageMarkdown(coverage), /Observed means linked production Run evidence, not a passed hard gate/u);
    const pending = await createEvaluationAssessmentQueue(evaluation, created.id);
    assert.equal(pending.expected, 72);
    assert.equal(pending.observed, 0);
    assert.equal(pending.pendingAssessment, 72);
    assert.ok(pending.cells.every((cell) => cell.hardGates.every((gate) => gate.state === "not-evaluated")
      && cell.quality.score === null && cell.failureClassification === "pending"));
    await db("o_project").insert({ id: 7, userId: 1, name: "评测项目" });
    const queue: Array<() => Promise<void>> = [];
    const runtime = createAgentRuntime({ work: async (operation) => operation(db),
      now: () => 250, createId: () => `run-${++serial}`,
      schedule: (work) => queue.push(work),
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "text-v1",
        temperature: 2, maxOutputTokens: 256 },
      invokeText: async () => ({ text: "局部只读建议" }) as any }) });
    const adapter = createEvaluationAgentCase({ evaluation, runtime,
      currentRevisions: async () => revisions,
      awaitScheduledWork: async () => { while (queue.length) await queue.shift()!(); } });
    await adapter.execute({ evaluationRunId: created.id,
      caseId: caseInputs[0].caseId, seed: 11, variant: "baseline", projectId: 7,
      role: caseInputs[0].role, scope: caseInputs[0].scope,
      content: caseInputs[0].content });
    const after = await createEvaluationCoverageReport(evaluation, created.id);
    assert.deepEqual(after.baseline, { observed: 1, missing: 35 });
    assert.deepEqual(after.candidate, { observed: 0, missing: 36 });
    assert.equal(after.cells[0].baseline, "observed");
    const queueAfter = await createEvaluationAssessmentQueue(evaluation, created.id);
    assert.equal(queueAfter.observed, 1);
    assert.equal(queueAfter.pendingAssessment, 72);
    assert.equal(queueAfter.cells[0].runStatus, "succeeded");
    assert.equal(queueAfter.cells[0].hardGates[0].state, "not-evaluated");
    assert.equal(queueAfter.cells[0].quality.score, null);
    await db("o_agentRun").update({ version: 999 });
    await assert.rejects(createEvaluationCoverageReport(evaluation, created.id), /evidence has changed/u);
    await assert.rejects(freezeGoldenEvaluationRun(evaluation, { ...input,
      caseInputs: caseInputs.slice(1) }), /frozen case order/u);
    await assert.rejects(freezeGoldenEvaluationRun(evaluation, { ...input,
      caseInputs: [{ ...caseInputs[0], content: "" }, ...caseInputs.slice(1)] }), /frozen case order/u);
    const crlf = await freezeGoldenEvaluationRun(evaluation, { ...input,
      manifestSource: manifestSource.replace(/\r\n?/gu, "\n").replace(/\n/gu, "\r\n") });
    const crlfFrozen = await evaluation.inspect(crlf.id);
    assert.equal(crlfFrozen.manifest.caseManifestHash, frozen.manifest.caseManifestHash);
    assert.equal((await db("o_agentEvaluationRun")).length, 2);
    await db("o_agentEvaluationRun").where({ id: created.id })
      .update({ manifestJson: "corrupt" }).then(() => assert.fail("immutable manifest accepted"),
        (error: Error) => assert.match(error.message, /immutable/u));
  } finally { await db.destroy(); }
});
