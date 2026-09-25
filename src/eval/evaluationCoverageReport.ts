import { validateGoldenEvalManifest,
  type GoldenEvalPartition } from "./goldenEval";
import { createEvaluationRunRuntime } from "./evaluationRun";

export const EVALUATION_COVERAGE_REPORT_VERSION = "toonflow.evaluation-coverage-report.v2" as const;
type Evaluation = ReturnType<typeof createEvaluationRunRuntime>;
type Variant = "baseline" | "candidate";
type CellState = "missing" | "observed";

export interface EvaluationCoverageReport {
  schemaVersion: typeof EVALUATION_COVERAGE_REPORT_VERSION;
  evaluationRunId: string;
  manifestHash: string;
  caseManifestHash: string;
  disclaimer: "coverage-only-no-score-or-quality-conclusion";
  definedCases: number;
  seedsPerCase: number;
  expectedPerVariant: number;
  baseline: { observed: number; missing: number };
  candidate: { observed: number; missing: number };
  cells: Array<{ caseId: string; partition: GoldenEvalPartition;
    seed: number; baseline: CellState; candidate: CellState }>;
}

/** Only structural coverage; inspect fail-closes on corrupt or changed source Agent Runs. */
export async function createEvaluationCoverageReport(evaluation: Evaluation,
  evaluationRunId: string): Promise<EvaluationCoverageReport> {
  const observed = await evaluation.inspect(evaluationRunId);
  if (!observed.manifest.goldenManifestJson) {
    throw new TypeError("Evaluation coverage requires a frozen Golden manifest");
  }
  const golden = validateGoldenEvalManifest(JSON.parse(observed.manifest.goldenManifestJson) as unknown);
  const known = new Set(observed.cases.map((entry) =>
    `${entry.variant}:${entry.caseId}:${entry.seed}`));
  const cells = golden.cases.flatMap((entry) => observed.manifest.seeds.map((seed) => ({
    caseId: entry.id, partition: entry.partition, seed,
    baseline: (known.has(`baseline:${entry.id}:${seed}`) ? "observed" : "missing") as CellState,
    candidate: (known.has(`candidate:${entry.id}:${seed}`) ? "observed" : "missing") as CellState,
  })));
  const count = (variant: Variant) => ({
    observed: cells.filter((entry) => entry[variant] === "observed").length,
    missing: cells.filter((entry) => entry[variant] === "missing").length,
  });
  return { schemaVersion: EVALUATION_COVERAGE_REPORT_VERSION,
    evaluationRunId, manifestHash: observed.manifestHash,
    caseManifestHash: observed.manifest.caseManifestHash,
    disclaimer: "coverage-only-no-score-or-quality-conclusion",
    definedCases: golden.cases.length, seedsPerCase: observed.manifest.seeds.length,
    expectedPerVariant: cells.length, baseline: count("baseline"),
    candidate: count("candidate"), cells };
}

export function renderEvaluationCoverageMarkdown(report: EvaluationCoverageReport): string {
  const rows = report.cells.map((entry) =>
    `| ${entry.caseId} | ${entry.partition} | ${entry.seed} | ${entry.baseline} | ${entry.candidate} |`);
  return ["# Evaluation coverage (not a quality result)", "",
    `Evaluation Run: ${report.evaluationRunId}`,
    `Golden manifest: ${report.caseManifestHash}`,
    `Defined cases: ${report.definedCases}; seeds per case: ${report.seedsPerCase}`,
    `Expected per variant: ${report.expectedPerVariant}`,
    `Baseline: ${report.baseline.observed} observed, ${report.baseline.missing} missing`,
    `Candidate: ${report.candidate.observed} observed, ${report.candidate.missing} missing`,
    "Observed means linked production Run evidence, not a passed hard gate or human score.", "",
    "| Case | Partition | Seed | Baseline | Candidate |",
    "| --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
}
