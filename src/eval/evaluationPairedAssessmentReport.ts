import { createEvaluationAssessmentLedger, type EvaluationAssessment } from "./evaluationAssessment";
import { createEvaluationCoverageReport } from "./evaluationCoverageReport";
import { createEvaluationRunRuntime } from "./evaluationRun";

export const PAIRED_ASSESSMENT_REPORT_VERSION = "toonflow.paired-assessment-report.v1" as const;
type Evaluation = ReturnType<typeof createEvaluationRunRuntime>;
type Assessment = ReturnType<typeof createEvaluationAssessmentLedger>;
type SideState = "missing-run" | "unassessed" | "run-failed" | "pending-review" | "gate-failed" | "reviewed";

export interface PairedAssessmentSide {
  state: SideState;
  sourceEvidenceHash: string | null;
  score: 0 | 1 | 2 | null;
  failedGates: string[];
}

export interface PairedAssessmentReport {
  schemaVersion: typeof PAIRED_ASSESSMENT_REPORT_VERSION;
  evaluationRunId: string;
  manifestHash: string;
  caseManifestHash: string;
  disclaimer: "self-reported-assessments-not-independent-verification";
  expectedPairs: number;
  completePairs: number;
  blockedPairs: number;
  observedRuns: number;
  assessedRuns: number;
  cells: Array<{ caseId: string; partition: string; seed: number;
    baseline: PairedAssessmentSide; candidate: PairedAssessmentSide;
    provisionalScoreDelta: number | null }>;
}

const key = (variant: string, caseId: string, seed: number) => `${variant}:${caseId}:${seed}`;

/** A complete matrix of submitted reviews, never a verified quality or cost conclusion. */
export async function createEvaluationPairedAssessmentReport(evaluation: Evaluation,
  assessment: Assessment, evaluationRunId: string): Promise<PairedAssessmentReport> {
  const coverage = await createEvaluationCoverageReport(evaluation, evaluationRunId);
  const inspected = await assessment.inspect(evaluationRunId);
  if (inspected.expected !== coverage.expectedPerVariant * 2) {
    throw new Error("Assessment denominator differs from frozen Golden coverage");
  }
  const byKey = new Map<string, EvaluationAssessment>(inspected.assessments.map((entry) =>
    [key(entry.variant, entry.caseId, entry.seed), entry]));
  const side = (variant: "baseline" | "candidate", caseId: string, seed: number,
    observed: boolean): PairedAssessmentSide => {
    const review = byKey.get(key(variant, caseId, seed));
    if (!observed) {
      if (review) throw new Error("Assessment exists without an observed production Run");
      return { state: "missing-run", sourceEvidenceHash: null, score: null, failedGates: [] };
    }
    if (!review) return { state: "unassessed", sourceEvidenceHash: null, score: null, failedGates: [] };
    const failedGates = review.hardGates.filter((gate) => !gate.passed).map((gate) => gate.id);
    const state = review.failureClassification ? "run-failed" : failedGates.length ? "gate-failed"
      : review.quality.state === "pending" ? "pending-review" : "reviewed";
    return { state, sourceEvidenceHash: review.sourceEvidenceHash,
      score: review.quality.score, failedGates };
  };
  const cells = coverage.cells.map((cell) => {
    const baseline = side("baseline", cell.caseId, cell.seed, cell.baseline === "observed");
    const candidate = side("candidate", cell.caseId, cell.seed, cell.candidate === "observed");
    return { caseId: cell.caseId, partition: cell.partition, seed: cell.seed,
      baseline, candidate,
      provisionalScoreDelta: baseline.state === "reviewed" && candidate.state === "reviewed"
        ? candidate.score! - baseline.score! : null };
  });
  return { schemaVersion: PAIRED_ASSESSMENT_REPORT_VERSION,
    evaluationRunId, manifestHash: coverage.manifestHash,
    caseManifestHash: coverage.caseManifestHash,
    disclaimer: "self-reported-assessments-not-independent-verification",
    expectedPairs: cells.length,
    completePairs: cells.filter((cell) => cell.provisionalScoreDelta !== null).length,
    blockedPairs: cells.filter((cell) => cell.provisionalScoreDelta === null).length,
    observedRuns: coverage.baseline.observed + coverage.candidate.observed,
    assessedRuns: inspected.assessed, cells };
}

export function renderEvaluationPairedAssessmentMarkdown(report: PairedAssessmentReport): string {
  const rows = report.cells.map((cell) =>
    `| ${cell.caseId} | ${cell.partition} | ${cell.seed} | ${cell.baseline.state} | ${cell.candidate.state} | ${cell.provisionalScoreDelta ?? "—"} |`);
  return ["# Paired assessment ledger (not a verified quality result)", "",
    `Evaluation Run: ${report.evaluationRunId}`,
    `Golden manifest: ${report.caseManifestHash}`,
    `Pairs: ${report.completePairs}/${report.expectedPairs} provisionally reviewed; ${report.blockedPairs} blocked`,
    `Production Runs: ${report.observedRuns}/${report.expectedPairs * 2} observed; ${report.assessedRuns} assessed`,
    "Gate decisions and scores are submitted assessments; evidence references and assessor identity are not independently verified.",
    "A score delta is shown only when both sides have submitted passing gates and reviewed quality. It is not a causal improvement claim.",
    "Cost is unknown; this report makes no latency or cost comparison.", "",
    "| Case | Partition | Seed | Baseline | Candidate | Provisional score delta |",
    "| --- | --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
}
