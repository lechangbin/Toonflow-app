import type { DatabaseWork } from "@/database";
import { auditCausalTraceTimeline } from "@/agentRuntime/causalTrace";

import { hashGoldenEvalManifest, validateGoldenEvalManifest } from "./goldenEval";

export const EVALUATION_CASE_OBSERVATION_SCHEMA_VERSION = "toonflow.evaluation-case-observation.v1" as const;
const IDENTIFIER = /^[A-Za-z0-9._:@-]{1,128}$/;

export interface EvaluationCaseObservation {
  schemaVersion: typeof EVALUATION_CASE_OBSERVATION_SCHEMA_VERSION;
  evaluationRunId: string;
  caseId: string;
  agentRunId: string;
  agentRunVersion: number;
  agentRunStatus: "waiting" | "succeeded" | "failed" | "cancelled";
  agentRunTraceSequence: number;
  observedAt: number;
}

/** Attach an actual production Agent Run; scoring remains pending until artifact semantics can be verified. */
export function createEvaluationCaseObservationStore(work: DatabaseWork, now: () => number) {
  return {
    async attach(input: { evaluationRunId: string; caseId: string; agentRunId: string }): Promise<EvaluationCaseObservation> {
      if (![input.evaluationRunId, input.caseId, input.agentRunId].every((id) => IDENTIFIER.test(id))) {
        throw new Error("Evaluation identity is invalid");
      }
      const observedAt = now();
      if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error("Evaluation observation time is invalid");
      return work((db) => db.transaction(async (tx) => {
        const evaluation = await tx("o_evaluationRun").where({ id: input.evaluationRunId }).first();
        const current = await tx("o_evaluationCase").where({ evaluationRunId: input.evaluationRunId,
          caseId: input.caseId, status: "pending" }).first();
        if (!evaluation || !current || evaluation.status === "completed"
          || evaluation.recordSchemaVersion !== "toonflow.evaluation-run.v1"
          || hashGoldenEvalManifest(evaluation.manifestJson) !== evaluation.manifestHash) {
          throw new Error("Frozen Evaluation Run or pending Case is unavailable");
        }
        const manifest = validateGoldenEvalManifest(JSON.parse(evaluation.manifestJson) as unknown);
        const manifestCase = manifest.cases.find((entry) => entry.id === input.caseId);
        if (!manifestCase || manifestCase.partition !== current.partition) {
          throw new Error("Evaluation Case differs from frozen manifest");
        }
        const run = await tx("o_agentRun").where({ id: input.agentRunId,
          clientRequestId: `eval:${input.evaluationRunId}:${input.caseId}` }).first();
        if (!run || !Number.isSafeInteger(run.version) || run.version <= 0
          || !["succeeded", "failed", "cancelled", "waiting"].includes(run.status)
          || (run.status === "waiting" && !run.attentionReason)) {
          throw new Error("Evaluation Case requires an observable production Agent Run");
        }
        const traceRows = await tx("o_agentTrace").where({ runId: run.id }).orderBy("sequence");
        if (auditCausalTraceTimeline(traceRows).linkage !== "linked") {
          throw new Error("Evaluation Agent Run lacks an intact causal Trace");
        }
        const changed = await tx("o_evaluationCase").where({ id: current.id, status: "pending" }).update({
          agentRunId: run.id, agentRunVersion: run.version, agentRunStatus: run.status,
          agentRunTraceSequence: traceRows.length, status: "observed", observedAt,
        });
        if (changed !== 1) throw new Error("Evaluation Case observation was already attached");
        await tx("o_evaluationRun").where({ id: evaluation.id, status: "pending" }).update({ status: "running" });
        return { schemaVersion: EVALUATION_CASE_OBSERVATION_SCHEMA_VERSION,
          evaluationRunId: evaluation.id, caseId: input.caseId, agentRunId: run.id,
          agentRunVersion: run.version, agentRunStatus: run.status,
          agentRunTraceSequence: traceRows.length, observedAt };
      }));
    },
  };
}
