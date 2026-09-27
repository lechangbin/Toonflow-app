import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { hashAgentRuntimeCorpus, validateAgentRuntimeCorpus } from
  "../src/eval/agentRuntimeCorpus";
import { hashEvaluationInput, type EvaluationRunManifest } from
  "../src/eval/evaluationRun";
import { assertSkillOnlyRuntimeCorpusTreatment } from
  "../src/eval/runtimeCorpusTreatment";

test("T11 skill-only study rejects hidden model, Vendor or Runtime changes", () => {
  const source = readFileSync(path.resolve(
    "data/eval/agent-runtime-corpus-v1/manifest.json"), "utf8");
  const corpus = validateAgentRuntimeCorpus(JSON.parse(source) as unknown);
  const baseline = { app: "same", schema: "same", runtime: "same", tool: "same",
    context: "same", memory: "same", skill: "baseline-guidance",
    model: "agnes-3.0-flash-policy-1", vendor: "same" };
  const manifest: EvaluationRunManifest = {
    schemaVersion: "toonflow.evaluation-run.v3", studyId: "t11-skill-only",
    caseManifestHash: hashAgentRuntimeCorpus(source), agentRuntimeCorpusJson: source,
    caseIds: corpus.cases.map((item) => item.id),
    caseInputs: corpus.cases.map((item) => ({ caseId: item.id, projectId: 7,
      actorUserId: 1, contentHash: hashEvaluationInput(item.content),
      role: item.role, scope: item.scope })),
    seeds: [11, 29], variants: ["baseline", "candidate"], baseline,
    candidate: { ...baseline, skill: "candidate-provenance-guidance" }, frozenAt: 100,
  };
  assert.equal(assertSkillOnlyRuntimeCorpusTreatment(manifest).expectedCells, 72);
  assert.throws(() => assertSkillOnlyRuntimeCorpusTreatment({ ...manifest,
    candidate: baseline }), /only the Skill/u);
  for (const changed of [{ model: "another-model" }, { vendor: "another-vendor" },
    { runtime: "another-runtime" }, { context: "another-context" }]) {
    assert.throws(() => assertSkillOnlyRuntimeCorpusTreatment({ ...manifest,
      candidate: { ...manifest.candidate, ...changed } }), /common environment|only the Skill/u);
  }
});
