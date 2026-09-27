import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { hashAgentRuntimeCorpus, validateAgentRuntimeCorpus } from
  "../src/eval/agentRuntimeCorpus";
import { hashEvaluationInput, type EvaluationRunManifest } from
  "../src/eval/evaluationRun";
import { planRuntimeCorpusMatrixOrder } from "../src/eval/runtimeCorpusMatrixOrder";

test("T11 interleaves 36 pairs with balanced first treatment and safe resume order", () => {
  const source = readFileSync(path.resolve(
    "data/eval/agent-runtime-corpus-v1/manifest.json"), "utf8");
  const corpus = validateAgentRuntimeCorpus(JSON.parse(source) as unknown);
  const revisions = { app: "a", schema: "s", runtime: "r", tool: "t", context: "c",
    memory: "m", skill: "baseline", model: "agnes", vendor: "agnes-source" };
  const manifest: EvaluationRunManifest = {
    schemaVersion: "toonflow.evaluation-run.v3", studyId: "matrix-order",
    caseManifestHash: hashAgentRuntimeCorpus(source), agentRuntimeCorpusJson: source,
    caseIds: corpus.cases.map((item) => item.id),
    caseInputs: corpus.cases.map((item) => ({ caseId: item.id, projectId: 7,
      actorUserId: 1, contentHash: hashEvaluationInput(item.content),
      role: item.role, scope: item.scope })),
    seeds: [11, 29], variants: ["baseline", "candidate"], baseline: revisions,
    candidate: { ...revisions, skill: "candidate" }, frozenAt: 100,
  };
  const plan = planRuntimeCorpusMatrixOrder(manifest);
  assert.equal(plan.expectedPairs, 36);
  assert.equal(plan.expectedCells, 72);
  assert.equal(new Set(plan.fullOrder.map((cell) => cell.cellId)).size, 72);
  assert.equal(plan.fullOrder.filter((_, index) => index % 2 === 0
    && plan.fullOrder[index].variant === "baseline").length, 18);
  assert.equal(plan.fullOrder.filter((_, index) => index % 2 === 0
    && plan.fullOrder[index].variant === "candidate").length, 18);
  const resumed = planRuntimeCorpusMatrixOrder(manifest,
    plan.fullOrder.slice(0, 3).map((cell) => cell.cellId));
  assert.equal(resumed.remaining.length, 69);
  assert.equal(resumed.remaining[0].cellId, plan.fullOrder[3].cellId);
  assert.throws(() => planRuntimeCorpusMatrixOrder(manifest,
    [plan.fullOrder[0].cellId, plan.fullOrder[0].cellId]), /duplicate/u);
  assert.throws(() => planRuntimeCorpusMatrixOrder(manifest,
    ["baseline:DEV-RT-999:11"]), /outside/u);
});
