import { createHash } from "node:crypto";

import type { DatabaseWork } from "@/database";
import { AGENT_RUN_OUTPUT_SCHEMA_VERSION } from "@/agentRuntime";
import { inspectPersistableText } from "@/diagnostics/traceSafeDiagnostics";

import type { EvaluationAssessment } from "./evaluationAssessment";
import { createEvaluationRunRuntime } from "./evaluationRun";

type Evaluation = ReturnType<typeof createEvaluationRunRuntime>;
type Cell = Pick<EvaluationAssessment, "evaluationRunId" | "variant" | "caseId" | "seed">;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const RUNTIME_EVIDENCE_ARTIFACT_VERSION = "toonflow.runtime-evidence-artifact.v1" as const;
const KINDS = ["agent-run-output", "tool-receipts", "trace"] as const;

/** Deterministic protected-review projections of the observed production Run, not reviewer-authored files. */
export async function createRuntimeCorpusEvidenceArtifacts(input: {
  work: DatabaseWork; evaluation: Evaluation;
} & Cell): Promise<Array<{ kind: typeof KINDS[number]; content: string; sha256: string }>> {
  const observed = await input.evaluation.inspect(input.evaluationRunId);
  if (!observed.manifest.agentRuntimeCorpusJson) {
    throw new TypeError("Runtime evidence artifacts require a frozen AgentRuntime corpus");
  }
  const cell = observed.cases.find((entry) => entry.variant === input.variant
    && entry.caseId === input.caseId && entry.seed === input.seed);
  if (!cell) throw new TypeError("Runtime evidence artifacts require an observed cell");
  const evidenceHash = hash(JSON.stringify(cell));
  const rows = await input.work((db) => db.transaction(async (tx) => ({
    outputs: await tx("o_agentRunOutput").where({ runId: cell.agentRunId })
      .orderBy("id", "asc").select("id", "stepId", "kind", "content", "contentHash", "schemaVersion"),
    receipts: await tx("o_agentToolReceipt").where({ runId: cell.agentRunId })
      .orderBy("id", "asc").select("id", "operationId", "toolName", "toolRevision",
        "inputHash", "status", "outputJson", "outputHash"),
    traces: await tx("o_agentTrace").where({ runId: cell.agentRunId })
      .orderBy("sequence", "asc").select("id", "sequence", "predecessorTraceId",
        "eventType", "toolReceiptId", "toolCallId", "vendorRequestId",
        "videoVendorRequestId", "imageArtifactId", "videoArtifactId"),
  })));
  if (rows.outputs.length !== 1 || rows.traces.length === 0) {
    throw new Error("Runtime evidence artifacts require one Output and a causal Trace");
  }
  if (rows.outputs[0].schemaVersion !== AGENT_RUN_OUTPUT_SCHEMA_VERSION
    || hash(JSON.stringify(rows.outputs[0].content)) !== rows.outputs[0].contentHash
    || rows.outputs[0].contentHash !== cell.outputHash) {
    throw new Error("Runtime evidence artifact Output differs from the frozen source cell");
  }
  const payloads = [rows.outputs[0], rows.receipts, rows.traces];
  return KINDS.map((kind, index) => {
    const content = `${JSON.stringify({ schemaVersion: RUNTIME_EVIDENCE_ARTIFACT_VERSION,
      evaluationRunId: input.evaluationRunId, variant: input.variant,
      caseId: input.caseId, seed: input.seed, agentRunId: cell.agentRunId,
      sourceEvidenceHash: evidenceHash, kind, payload: payloads[index] })}\n`;
    if (!inspectPersistableText(content).ok) {
      throw new Error("Runtime evidence artifact contains unsafe material");
    }
    return { kind, content, sha256: hash(content) };
  });
}

/** Compare assessment artifact hashes with exact source-Run projections; file bytes are checked separately. */
export async function verifyRuntimeCorpusEvidenceArtifactProvenance(input: {
  work: DatabaseWork; evaluation: Evaluation; assessment: EvaluationAssessment;
}): Promise<void> {
  const artifacts = await createRuntimeCorpusEvidenceArtifacts({ ...input,
    evaluationRunId: input.assessment.evaluationRunId,
    variant: input.assessment.variant, caseId: input.assessment.caseId,
    seed: input.assessment.seed });
  if (input.assessment.artifacts.length !== artifacts.length
    || artifacts.some((item) => input.assessment.artifacts.find((entry) => entry.kind === item.kind)
      ?.sha256 !== item.sha256)) {
    throw new Error("Assessment artifacts differ from source Agent Run projections");
  }
}
