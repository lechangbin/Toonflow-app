import type { Knex } from "knex";
import { validateTraceSafeDiagnostic, type TraceSafeDiagnostic } from "@/diagnostics/traceSafeDiagnostics";

export const TRACE_TIMELINE_EVIDENCE_SCHEMA_VERSION = "toonflow.trace-timeline-evidence.v1" as const;

export interface TraceTimelineEvidence {
  schemaVersion: typeof TRACE_TIMELINE_EVIDENCE_SCHEMA_VERSION;
  ordering: "durable-sequence";
  linkage: "linked" | "legacy-unlinked" | "corrupt";
  eventCount: number;
}

/** Old rows have no predecessor edge; never infer one merely from timestamps. */
export function auditCausalTraceTimeline(rows: readonly {
  id: string; sequence: number; predecessorTraceId?: string | null;
}[]): TraceTimelineEvidence {
  let linkage: TraceTimelineEvidence["linkage"] = rows.length === 0 ? "legacy-unlinked" : "linked";
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const previous = rows[index - 1];
    if (!row.id || !Number.isSafeInteger(row.sequence) || row.sequence !== index + 1
      || (!previous && row.predecessorTraceId)
      || (previous && row.predecessorTraceId && row.predecessorTraceId !== previous.id)) {
      linkage = "corrupt";
      break;
    }
    if (previous && !row.predecessorTraceId) linkage = "legacy-unlinked";
  }
  return { schemaVersion: TRACE_TIMELINE_EVIDENCE_SCHEMA_VERSION,
    ordering: "durable-sequence", linkage, eventCount: rows.length };
}

/** A Trace contains durable identifiers and safe status codes, never Provider payloads. */
export interface CausalTraceInput {
  id: string;
  runId: string;
  eventType: string;
  createdAt: number;
  stepId?: string;
  attemptId?: string;
  toolReceiptId?: string;
  toolCallId?: string;
  vendorRequestId?: string;
  imageArtifactId?: string;
  runStatus?: string;
  stepStatus?: string;
  diagnostic?: TraceSafeDiagnostic;
}

/** Append inside the same transaction as the state change, so sequence and cause cannot diverge. */
export async function appendCausalTrace(tx: Knex.Transaction, input: CausalTraceInput): Promise<void> {
  const diagnostic = input.diagnostic && validateTraceSafeDiagnostic(input.diagnostic, "trace");
  if (diagnostic && !diagnostic.ok) throw new Error("Trace diagnostic violates safe contract");
  const links = [
    ["o_agentRunStep", input.stepId],
    ["o_agentRunAttempt", input.attemptId],
    ["o_agentToolReceipt", input.toolReceiptId],
    ["o_agentToolCall", input.toolCallId],
    ["o_agentVendorRequest", input.vendorRequestId],
  ] as const;
  for (const [table, id] of links) {
    if (id && !await tx(table).where({ id, runId: input.runId }).first("id")) {
      throw new Error("Trace correlation does not belong to Run");
    }
  }
  if (input.attemptId) {
    const attempt = await tx("o_agentRunAttempt").where({ id: input.attemptId }).first("stepId");
    if (!input.stepId || attempt?.stepId !== input.stepId) throw new Error("Trace attempt does not match Step");
  }
  if (input.toolCallId) {
    const call = await tx("o_agentToolCall").where({ id: input.toolCallId }).first("stepId", "attemptId", "receiptId");
    if (!input.stepId || !input.attemptId || !input.toolReceiptId
      || call?.stepId !== input.stepId || call?.attemptId !== input.attemptId
      || call?.receiptId !== input.toolReceiptId) throw new Error("Trace ToolCall does not match parent links");
  }
  if (input.vendorRequestId) {
    const request = await tx("o_agentVendorRequest").where({ id: input.vendorRequestId }).first("toolCallId");
    if (!input.toolCallId || request?.toolCallId !== input.toolCallId) {
      throw new Error("Trace VendorRequest does not match ToolCall");
    }
  }
  if (input.imageArtifactId && !await tx("o_agentImageArtifact as artifact")
    .join("o_agentVendorRequest as request", "request.id", "artifact.vendorRequestId")
    .where({ "artifact.id": input.imageArtifactId, "request.runId": input.runId }).first("artifact.id")) {
    throw new Error("Trace correlation does not belong to Run");
  }
  if (input.imageArtifactId) {
    const artifact = await tx("o_agentImageArtifact").where({ id: input.imageArtifactId }).first("vendorRequestId");
    if (!input.vendorRequestId || artifact?.vendorRequestId !== input.vendorRequestId) {
      throw new Error("Trace Artifact does not match VendorRequest");
    }
  }
  const previous = await tx("o_agentTrace").where({ runId: input.runId })
    .orderBy("sequence", "desc").first("id", "sequence");
  await tx("o_agentTrace").insert({
    ...input,
    diagnostic: diagnostic ? JSON.stringify(diagnostic.value) : null,
    diagnosticSchemaVersion: diagnostic?.value.schemaVersion ?? null,
    sequence: Number(previous?.sequence ?? 0) + 1,
    predecessorTraceId: previous?.id ?? null,
  });
}
