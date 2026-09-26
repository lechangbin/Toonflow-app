import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { EvaluationAssessment } from "../src/eval/evaluationAssessment";
import { verifyEvaluationAssessmentArtifacts } from "../src/eval/evaluationArtifactVerifier";

test("T11 verifier rehashes declared artifacts and checks all review references stay local", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "toonflow-assessment-evidence-"));
  try {
    await fs.mkdir(path.join(root, "artifacts"));
    await fs.mkdir(path.join(root, "docs"));
    await fs.writeFile(path.join(root, "artifacts", "count.json"), '{"count":2}\n');
    await fs.writeFile(path.join(root, "docs", "review.md"), "Checked local fixture.\n");
    const digest = createHash("sha256").update('{"count":2}\n').digest("hex");
    const assessment: EvaluationAssessment = {
      schemaVersion: "toonflow.evaluation-assessment.v1",
      evaluationRunId: "evaluation-1", caseId: "DEV-EXT-001", seed: 11,
      variant: "baseline", sourceEvidenceHash: "a".repeat(64),
      assessorId: "fixture-reviewer", method: "manual-review",
      hardGates: [{ id: "two-model-calls", passed: true,
        evidenceRefs: ["artifacts/count.json"] }],
      artifacts: [{ kind: "modelCallCount", ref: "artifacts/count.json", sha256: digest }],
      quality: { state: "reviewed", rubricVersion: "production-quality@1.0.0",
        score: 2, reviewerId: "fixture-reviewer", reason: "fixture",
        evidenceRefs: ["docs/review.md"] },
      failureClassification: null, costMicros: null, assessedAt: 100,
    };
    const verified = await verifyEvaluationAssessmentArtifacts(root, assessment);
    assert.equal(verified.files.length, 2);
    assert.equal(verified.artifactHashesVerified, true);
    assert.equal(verified.gateSemanticsVerified, false);
    assert.equal(verified.reviewerIdentityVerified, false);
    await assert.rejects(verifyEvaluationAssessmentArtifacts(root, { ...assessment,
      artifacts: [{ ...assessment.artifacts[0], sha256: "b".repeat(64) }] }), /digest differs/u);
    await assert.rejects(verifyEvaluationAssessmentArtifacts(root, { ...assessment,
      hardGates: [{ ...assessment.hardGates[0], evidenceRefs: ["docs/missing.md"] }] }),
    /ENOENT/u);
    await assert.rejects(verifyEvaluationAssessmentArtifacts(root, { ...assessment,
      hardGates: [{ ...assessment.hardGates[0], evidenceRefs: ["docs/../outside.md"] }] }),
    /unsafe/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
