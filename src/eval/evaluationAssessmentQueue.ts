import { validateGoldenEvalManifest,
  type GoldenEvalPartition } from "./goldenEval";
import { createEvaluationRunRuntime } from "./evaluationRun";

export const EVALUATION_ASSESSMENT_QUEUE_VERSION = "toonflow.evaluation-assessment-queue.v1" as const;
type Evaluation = ReturnType<typeof createEvaluationRunRuntime>;

/** A review queue, not a scoring result: Run success never implies a Golden hard gate passed. */
export async function createEvaluationAssessmentQueue(evaluation: Evaluation,
  evaluationRunId: string) {
  const observed = await evaluation.inspect(evaluationRunId);
  if (!observed.manifest.goldenManifestJson) {
    throw new TypeError("Evaluation assessment requires a frozen Golden manifest");
  }
  const golden = validateGoldenEvalManifest(JSON.parse(observed.manifest.goldenManifestJson) as unknown);
  const evidence = new Map(observed.cases.map((entry) =>
    [`${entry.variant}:${entry.caseId}:${entry.seed}`, entry] as const));
  const cells: Array<{ caseId: string; partition: GoldenEvalPartition;
    seed: number; variant: "baseline" | "candidate";
    observation: "missing" | "observed"; agentRunId: string | null;
    runStatus: "succeeded" | "failed" | "cancelled" | null;
    hardGates: Array<{ id: string; state: "not-evaluated" }>;
    requiredArtifacts: string[];
    quality: { rubricVersion: string; state: "pending"; score: null };
    failureClassification: "pending"; elapsedMs: number | null;
    costMicros: null }> = [];
  for (const variant of observed.manifest.variants) {
    for (const entry of golden.cases) {
      for (const seed of observed.manifest.seeds) {
        const source = evidence.get(`${variant}:${entry.id}:${seed}`);
        cells.push({ caseId: entry.id, partition: entry.partition,
          seed, variant, observation: source ? "observed" : "missing",
          agentRunId: source?.agentRunId ?? null,
          runStatus: source?.runStatus ?? null,
          hardGates: entry.hardGates.map((gate) => ({ id: gate.id, state: "not-evaluated" })),
          requiredArtifacts: [...entry.requiredArtifacts],
          quality: { rubricVersion: golden.qualityRubricVersion, state: "pending", score: null },
          failureClassification: "pending", elapsedMs: source?.elapsedMs ?? null,
          costMicros: null });
      }
    }
  }
  return { schemaVersion: EVALUATION_ASSESSMENT_QUEUE_VERSION,
    evaluationRunId, manifestHash: observed.manifestHash,
    disclaimer: "review-queue-no-gate-or-quality-conclusion" as const,
    expected: cells.length, observed: observed.recorded,
    pendingAssessment: cells.length, cells };
}
