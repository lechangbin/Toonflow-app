import { createEvaluationAssessmentLedger, type EvaluationAssessment } from "./evaluationAssessment";
import { verifyEvaluationAssessmentArtifacts } from "./evaluationArtifactVerifier";
import { createEvaluationCoverageReport } from "./evaluationCoverageReport";
import { createEvaluationRunRuntime } from "./evaluationRun";
import type { DatabaseWork } from "@/database";
import { createRuntimeCorpusSafetyReport } from "./runtimeCorpusGateVerifier";
import { verifyRuntimeCorpusEvidenceArtifactProvenance } from "./runtimeCorpusEvidenceArtifacts";

export const PAIRED_ASSESSMENT_REPORT_VERSION = "toonflow.paired-assessment-report.v3" as const;
type Evaluation = ReturnType<typeof createEvaluationRunRuntime>;
type Assessment = ReturnType<typeof createEvaluationAssessmentLedger>;
type SideState = "missing-run" | "unassessed" | "run-failed" | "pending-review" | "gate-failed"
  | "unverified-safety" | "pending-semantic-verification" | "reviewed";

export interface PairedAssessmentSide {
  state: SideState;
  sourceEvidenceHash: string | null;
  score: 0 | 1 | 2 | null;
  failedGates: string[];
  evidenceFiles: Array<{ ref: string; sha256: string }> | null;
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
  evidenceFileCheckedRuns: number;
  sourceProvenanceCheckedRuns: number;
  cells: Array<{ caseId: string; partition: string; seed: number;
    baseline: PairedAssessmentSide; candidate: PairedAssessmentSide;
    provisionalScoreDelta: number | null }>;
}

const key = (variant: string, caseId: string, seed: number) => `${variant}:${caseId}:${seed}`;

/** A complete matrix of submitted reviews, never a verified quality or cost conclusion. */
export async function createEvaluationPairedAssessmentReport(evaluation: Evaluation,
  assessment: Assessment, evaluationRunId: string,
  options: { artifactRoot?: string; runtimeSafety?: { work: DatabaseWork;
    readFixture(path: string): Promise<string | Buffer> } } = {}): Promise<PairedAssessmentReport> {
  const coverage = await createEvaluationCoverageReport(evaluation, evaluationRunId);
  const frozen = await evaluation.inspect(evaluationRunId);
  const isRuntimeCorpus = frozen.manifest.agentRuntimeCorpusJson !== undefined;
  if (!isRuntimeCorpus && options.runtimeSafety) {
    throw new TypeError("Runtime safety verification requires an AgentRuntime corpus");
  }
  if (isRuntimeCorpus && options.artifactRoot !== undefined && !options.runtimeSafety) {
    throw new TypeError("Runtime artifact provenance requires the Runtime safety dependency");
  }
  const safety = options.runtimeSafety ? await createRuntimeCorpusSafetyReport({
    ...options.runtimeSafety, evaluation, evaluationRunId }) : null;
  if (safety && (safety.expected !== coverage.expectedPerVariant * 2
    || safety.caseManifestHash !== coverage.caseManifestHash)) {
    throw new Error("Runtime safety denominator differs from frozen case coverage");
  }
  const safetyByKey = new Map(safety?.cells.map((entry) =>
    [key(entry.variant, entry.caseId, entry.seed), entry]) ?? []);
  const inspected = await assessment.inspect(evaluationRunId);
  if (inspected.expected !== coverage.expectedPerVariant * 2) {
    throw new Error("Assessment denominator differs from frozen case coverage");
  }
  const byKey = new Map<string, EvaluationAssessment>(inspected.assessments.map((entry) =>
    [key(entry.variant, entry.caseId, entry.seed), entry]));
  const verifiedFiles = new Map<string, Array<{ ref: string; sha256: string }>>();
  let sourceProvenanceCheckedRuns = 0;
  if (options.artifactRoot !== undefined) {
    for (const review of inspected.assessments) {
      const verified = await verifyEvaluationAssessmentArtifacts(options.artifactRoot, review);
      if (verified.sourceEvidenceHash !== review.sourceEvidenceHash
        || !verified.artifactHashesVerified || verified.gateSemanticsVerified
        || verified.reviewerIdentityVerified) {
        throw new Error("Assessment file verification contract changed");
      }
      verifiedFiles.set(key(review.variant, review.caseId, review.seed), verified.files);
      if (isRuntimeCorpus && review.quality.state === "reviewed"
        && review.failureClassification === null) {
        await verifyRuntimeCorpusEvidenceArtifactProvenance({
          work: options.runtimeSafety!.work, evaluation, assessment: review });
        sourceProvenanceCheckedRuns++;
      }
    }
  }
  const side = (variant: "baseline" | "candidate", caseId: string, seed: number,
    observed: boolean): PairedAssessmentSide => {
    const review = byKey.get(key(variant, caseId, seed));
    if (!observed) {
      if (review) throw new Error("Assessment exists without an observed production Run");
      return { state: "missing-run", sourceEvidenceHash: null, score: null,
        failedGates: [], evidenceFiles: null };
    }
    if (!review) return { state: "unassessed", sourceEvidenceHash: null, score: null,
      failedGates: [], evidenceFiles: null };
    const failedGates = review.hardGates.filter((gate) => !gate.passed).map((gate) => gate.id);
    const checked = safetyByKey.get(key(variant, caseId, seed));
    if (safety && (!checked || checked.state === "missing-run"
      || checked.sourceEvidenceHash !== review.sourceEvidenceHash)) {
      throw new Error("Runtime safety evidence differs from submitted assessment");
    }
    if (checked?.state === "failed") failedGates.push(...checked.violations.map((item) => `runtime:${item}`));
    const state = review.failureClassification ? "run-failed" : failedGates.length ? "gate-failed"
      : review.quality.state === "pending" ? "pending-review"
        : isRuntimeCorpus ? checked ? "pending-semantic-verification" : "unverified-safety"
          : "reviewed";
    return { state, sourceEvidenceHash: review.sourceEvidenceHash,
      score: review.quality.score, failedGates,
      evidenceFiles: verifiedFiles.get(key(variant, caseId, seed)) ?? null };
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
    assessedRuns: inspected.assessed, evidenceFileCheckedRuns: verifiedFiles.size,
    sourceProvenanceCheckedRuns, cells };
}

export function renderEvaluationPairedAssessmentMarkdown(report: PairedAssessmentReport): string {
  const rows = report.cells.map((cell) =>
    `| ${cell.caseId} | ${cell.partition} | ${cell.seed} | ${cell.baseline.state} | ${cell.candidate.state} | ${cell.provisionalScoreDelta ?? "—"} |`);
  return ["# Paired assessment ledger (not a verified quality result)", "",
    `Evaluation Run: ${report.evaluationRunId}`,
    `Case manifest: ${report.caseManifestHash}`,
    `Pairs: ${report.completePairs}/${report.expectedPairs} provisionally reviewed; ${report.blockedPairs} blocked`,
    `Production Runs: ${report.observedRuns}/${report.expectedPairs * 2} observed; ${report.assessedRuns} assessed`,
    `Evidence reference files: ${report.evidenceFileCheckedRuns}/${report.assessedRuns} independently resolved and hashed.`,
    `Source-Run artifact provenance: ${report.sourceProvenanceCheckedRuns}/${report.assessedRuns} independently matched to production evidence projections.`,
    "Gate decisions, scores and assessor identity are submitted assessments, not independently verified; file hashing alone does not validate their semantics or source-Run linkage.",
    "For AgentRuntime corpus cells, machine checks establish fixture-consistent permitted reads and no recorded effects only; semantic output quality remains unverified.",
    "A score delta is shown only when both sides have submitted passing gates and reviewed quality. It is not a causal improvement claim.",
    "Cost is unknown; this report makes no latency or cost comparison.", "",
    "| Case | Partition | Seed | Baseline | Candidate | Provisional score delta |",
    "| --- | --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
}
