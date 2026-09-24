import type { DatabaseWork } from "@/database";
import { auditCausalTraceTimeline } from "@/agentRuntime/causalTrace";

import { assertComparableEvaluationContracts } from "./evaluationComparisonContract";
import { validateGoldenEvalManifest, type GoldenEvalPartition } from "./goldenEval";

export const EVALUATION_COVERAGE_REPORT_SCHEMA_VERSION = "toonflow.evaluation-coverage-report.v1" as const;
type CaseState = "pending" | "observed" | "missing-record" | "invalid-record";

export interface EvaluationCoverageReport {
  schemaVersion: typeof EVALUATION_COVERAGE_REPORT_SCHEMA_VERSION;
  baselineRunId: string;
  candidateRunId: string;
  manifestHash: string;
  changedTreatmentRevisions: string[];
  disclaimer: "coverage-only-no-score-or-quality-conclusion";
  defined: number;
  baseline: { pending: number; observed: number; missingRecord: number; invalidRecord: number };
  candidate: { pending: number; observed: number; missingRecord: number; invalidRecord: number };
  cases: Array<{ id: string; partition: GoldenEvalPartition;
    baseline: CaseState; candidate: CaseState }>;
}

const IDENTIFIER = /^[A-Za-z0-9._:@-]{1,128}$/;

function state(row: any, expectedPartition: GoldenEvalPartition): CaseState {
  if (!row) return "missing-record";
  if (row.partition !== expectedPartition) return "invalid-record";
  if (row.status === "pending" && row.agentRunId == null && row.hardGateResultsJson == null
    && row.qualityReviewJson == null && row.artifactRefsJson == null && row.failuresJson == null
    && row.observedAt == null && row.completedAt == null) return "pending";
  if (row.status === "observed" && typeof row.agentRunId === "string" && IDENTIFIER.test(row.agentRunId)
    && Number.isSafeInteger(row.agentRunVersion) && row.agentRunVersion > 0
    && Number.isSafeInteger(row.agentRunTraceSequence) && row.agentRunTraceSequence > 0
    && Number.isSafeInteger(row.observedAt) && row.observedAt >= 0
    && row.hardGateResultsJson == null && row.qualityReviewJson == null
    && row.artifactRefsJson == null && row.failuresJson == null && row.completedAt == null) return "observed";
  return "invalid-record";
}

function counts(states: readonly CaseState[]) {
  return { pending: states.filter((value) => value === "pending").length,
    observed: states.filter((value) => value === "observed").length,
    missingRecord: states.filter((value) => value === "missing-record").length,
    invalidRecord: states.filter((value) => value === "invalid-record").length };
}

/** Reproducible structural comparison; it deliberately never infers scores from Run status. */
export function createEvaluationCoverageReport(work: DatabaseWork) {
  return {
    async compare(input: { baselineRunId: string; candidateRunId: string }): Promise<EvaluationCoverageReport> {
      if (!IDENTIFIER.test(input.baselineRunId) || !IDENTIFIER.test(input.candidateRunId)) {
        throw new TypeError("Evaluation coverage identities are invalid");
      }
      return work((db) => db.transaction(async (tx) => {
        const [baseline, candidate] = await Promise.all([
          tx("o_evaluationRun").where({ id: input.baselineRunId }).first(),
          tx("o_evaluationRun").where({ id: input.candidateRunId }).first(),
        ]);
        if (!baseline || !candidate) throw new Error("Evaluation coverage requires two frozen Runs");
        const contract = assertComparableEvaluationContracts(baseline, candidate);
        const manifest = validateGoldenEvalManifest(JSON.parse(baseline.manifestJson) as unknown);
        const rows = await tx("o_evaluationCase").whereIn("evaluationRunId", [baseline.id, candidate.id]);
        const lookup = new Map<string, any>();
        for (const row of rows) {
          const key = `${row.evaluationRunId}:${row.caseId}`;
          if (lookup.has(key)) throw new Error("Evaluation coverage contains duplicate Case evidence");
          lookup.set(key, row);
        }
        if (rows.some((row) => !manifest.cases.some((entry) => entry.id === row.caseId))) {
          throw new Error("Evaluation coverage contains a Case absent from the frozen manifest");
        }
        const checkedState = async (evaluationRunId: string, caseId: string,
          partition: GoldenEvalPartition): Promise<CaseState> => {
          const row = lookup.get(`${evaluationRunId}:${caseId}`);
          const structural = state(row, partition);
          if (structural !== "observed") return structural;
          const agentRun = await tx("o_agentRun").where({ id: row.agentRunId,
            clientRequestId: `eval:${evaluationRunId}:${caseId}` }).first("id", "version");
          if (!agentRun || agentRun.version < row.agentRunVersion) return "invalid-record";
          const traces = await tx("o_agentTrace").where({ runId: agentRun.id }).orderBy("sequence", "asc");
          if (auditCausalTraceTimeline(traces).linkage !== "linked"
            || traces.length < row.agentRunTraceSequence) return "invalid-record";
          return structural;
        };
        const cases: EvaluationCoverageReport["cases"] = [];
        for (const entry of manifest.cases) {
          cases.push({ id: entry.id, partition: entry.partition,
            baseline: await checkedState(baseline.id, entry.id, entry.partition),
            candidate: await checkedState(candidate.id, entry.id, entry.partition) });
        }
        return { schemaVersion: EVALUATION_COVERAGE_REPORT_SCHEMA_VERSION,
          baselineRunId: baseline.id, candidateRunId: candidate.id, manifestHash: contract.manifestHash,
          changedTreatmentRevisions: contract.changedTreatmentRevisions,
          disclaimer: "coverage-only-no-score-or-quality-conclusion", defined: manifest.cases.length,
          baseline: counts(cases.map((entry) => entry.baseline)),
          candidate: counts(cases.map((entry) => entry.candidate)), cases };
      }));
    },
  };
}

/** Human-readable companion to the machine report; every Case is shown, with no aggregate quality claim. */
export function renderEvaluationCoverageMarkdown(report: EvaluationCoverageReport): string {
  const lines = ["# Evaluation coverage (not a score)", "",
    `Manifest: ${report.manifestHash}`, `Baseline: ${report.baselineRunId}`,
    `Candidate: ${report.candidateRunId}`, `Defined cases: ${report.defined}`, "",
    "Pending and observed mean no hard-gate or human quality result has been established.", "",
    "| Case | Partition | Baseline | Candidate |", "| --- | --- | --- | --- |",
    ...report.cases.map((entry) => `| ${entry.id} | ${entry.partition} | ${entry.baseline} | ${entry.candidate} |`),
    "", `Baseline counts: ${JSON.stringify(report.baseline)}`,
    `Candidate counts: ${JSON.stringify(report.candidate)}`, ""];
  return lines.join("\n");
}
