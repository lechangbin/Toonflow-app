import assert from "node:assert/strict";
import test from "node:test";

import { CONTEXT_ABLATION_VARIANTS, SKILL_ABLATION_VARIANTS,
  expectedAblationRunKeys,
  hashAblationManifest, summarizeAblationResults,
  validateAblationManifest } from
  "../src/eval/ablationContract";

const manifest = { schemaVersion: "toonflow.ablation-manifest.v1",
  studyId: "t19-context-v1", axis: "context", referenceVariant: "full-context",
  candidateVariants: [...CONTEXT_ABLATION_VARIANTS],
  caseManifestHash: "a".repeat(64), caseIds: ["DEV-TOOL-001", "HOLD-TOOL-001"],
  seeds: [11, 29], revisions: { app: "app-1", runtime: "run-1",
    tool: "tool-1", context: "context-1", memory: "memory-1",
    skill: "skill-1", model: "model-1", vendor: "vendor-1",
    cases: "cases-1" },
  commonBudget: { maxInputTokens: 2000, maxOutputTokens: 500,
    maxToolCalls: 4, timeoutMs: 30000 },
  thresholds: { minQualityScore: 1, maxP95LatencyMs: 2000,
    maxCostMicrosPerCase: 100000, maxRetriesPerCase: 1,
    zeroToleranceGateIds: ["leakage", "holdout-contamination",
      "redaction-failure", "permission-escalation"] }, frozenAt: 100 };

test("T19 contract freezes four Context leave-one-out variants and equal repeated run matrix", () => {
  const parsed = validateAblationManifest(manifest);
  assert.equal(expectedAblationRunKeys(parsed).length, 20);
  assert.equal(hashAblationManifest(parsed), hashAblationManifest({ ...manifest }));
});

test("T19 contract rejects changed variants, duplicate cases/seeds, and missing revision locks", () => {
  assert.throws(() => validateAblationManifest({ ...manifest,
    candidateVariants: ["without-retrieval", "without-memory",
      "without-compaction", "full-context"] }));
  assert.throws(() => validateAblationManifest({ ...manifest,
    caseIds: ["DEV-TOOL-001", "DEV-TOOL-001"] }));
  assert.throws(() => validateAblationManifest({ ...manifest, seeds: [11, 11] }));
  assert.throws(() => validateAblationManifest({ ...manifest,
    revisions: { ...manifest.revisions, model: "" } }));
});

test("T19 Skill variants retain mandatory permission hard gates", () => {
  const skillManifest = { ...manifest, studyId: "t19-skill-v1", axis: "skill",
    referenceVariant: "permission-gated-route",
    candidateVariants: [...SKILL_ABLATION_VARIANTS] };
  assert.equal(validateAblationManifest(skillManifest).candidateVariants.length, 4);
  assert.throws(() => validateAblationManifest({ ...skillManifest,
    thresholds: { ...skillManifest.thresholds,
      zeroToleranceGateIds: ["leakage", "holdout-contamination",
        "redaction-failure", "routing"] } }));
});

test("T19 result summary reports denominators and rejects hard-gate failure without a composite score", () => {
  const manifestHash = hashAblationManifest(manifest);
  const variants = [manifest.referenceVariant, ...manifest.candidateVariants];
  const rows = variants.flatMap((variant) => manifest.caseIds.flatMap((caseId) =>
    manifest.seeds.map((seed) => ({ manifestHash, executedAt: 200,
      variant, caseId, seed,
      qualityScore: 2, qualityEvidenceIds: ["rubric-review-1"], latencyMs: 200,
      costMicros: 10, inputTokens: 100, outputTokens: 50, toolCalls: 1,
      retries: 0, failureClass: "none", hardGates: { leakage: true,
        "holdout-contamination": true, "redaction-failure": true,
        "permission-escalation": true } }))));
  const complete = summarizeAblationResults(manifest, rows);
  assert.equal(complete.expected, 20);
  assert.equal(complete.missing, 0);
  assert(complete.variants.every((entry) => entry.adoptable));
  const failed = summarizeAblationResults(manifest, [
    { ...rows[0], hardGates: { ...rows[0].hardGates,
      "permission-escalation": false } }, ...rows.slice(1),
  ]);
  assert.equal(failed.variants[0].hardGateFailures["permission-escalation"], 1);
  assert.equal(failed.variants[0].adoptable, false);
  const partial = summarizeAblationResults(manifest, rows.slice(1));
  assert.equal(partial.missing, 1);
  assert.equal(partial.variants[0].adoptable, false);
  assert.throws(() => summarizeAblationResults(manifest, [...rows, rows[0]]));
  assert.throws(() => summarizeAblationResults(manifest,
    [{ ...rows[0], executedAt: 50 }]));
  assert.throws(() => summarizeAblationResults(manifest,
    [{ ...rows[0], qualityEvidenceIds: [] }]));
});
