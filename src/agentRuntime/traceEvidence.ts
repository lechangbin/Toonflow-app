import type { DatabaseWork } from "@/database";
import { inspectTraceSafePayload, validateTraceSafeDiagnostic, type TraceSafeDiagnostic } from "@/diagnostics/traceSafeDiagnostics";

import { auditCausalTraceTimeline, auditTraceFailureClassification,
  type TraceTimelineEvidence, type TraceFailureClassificationEvidence } from "./causalTrace";
import { AGENT_EVIDENCE_RETENTION_POLICY } from "./retention";

export const AGENT_TRACE_EXPORT_SCHEMA_VERSION = "toonflow.agent-trace-export.v1" as const;
export const TRACE_REDACTION_EVIDENCE_SCHEMA_VERSION = "toonflow.trace-redaction-evidence.v1" as const;
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const EVENT = /^[a-z][a-z0-9.-]{0,95}$/;
const MAX_EVENTS = 5000;

export class AgentTraceExportUnavailableError extends Error {
  constructor() { super("Safe Trace evidence is unavailable"); this.name = "AgentTraceExportUnavailableError"; }
}

export interface AgentTraceExportEvent {
  id: string;
  sequence: number;
  predecessorTraceId?: string;
  stepId?: string;
  attemptId?: string;
  toolReceiptId?: string;
  toolCallId?: string;
  vendorRequestId?: string;
  imageArtifactId?: string;
  eventType: string;
  runStatus?: string;
  stepStatus?: string;
  diagnostic?: TraceSafeDiagnostic;
  createdAt: number;
}

export interface AgentTraceExport {
  schemaVersion: typeof AGENT_TRACE_EXPORT_SCHEMA_VERSION;
  projectId: number;
  runId: string;
  timeline: TraceTimelineEvidence;
  failureClassification: TraceFailureClassificationEvidence;
  retention: typeof AGENT_EVIDENCE_RETENTION_POLICY;
  redaction: { schemaVersion: typeof TRACE_REDACTION_EVIDENCE_SCHEMA_VERSION; result: "passed" };
  events: AgentTraceExportEvent[];
}

const eventKeys = ["id", "sequence", "predecessorTraceId", "stepId", "attemptId", "toolReceiptId",
  "toolCallId", "vendorRequestId", "imageArtifactId", "eventType", "runStatus", "stepStatus",
  "diagnostic", "createdAt"];
const diagnosticKeys = ["schemaVersion", "audience", "failureClass", "stage", "kind", "severity",
  "certainty", "expectedness", "retryDisposition", "attributes", "causes", "name", "operation",
  "count", "retryable", "attempt", "elapsedMs", "httpStatus", "transportCode",
  "providerRequestId", "failureReasonHash"];

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function optionalIdentifier(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (!safeIdentifier(value)) throw new AgentTraceExportUnavailableError();
  return value;
}

function projectEvent(row: any): AgentTraceExportEvent {
  if (!safeIdentifier(row.id) || !Number.isSafeInteger(row.sequence) || !EVENT.test(row.eventType)
    || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0) throw new AgentTraceExportUnavailableError();
  let diagnostic: TraceSafeDiagnostic | undefined;
  if (row.diagnostic !== null && row.diagnostic !== undefined) {
    let raw: unknown;
    try { raw = JSON.parse(row.diagnostic); } catch { throw new AgentTraceExportUnavailableError(); }
    const checked = validateTraceSafeDiagnostic(raw, "trace");
    if (!checked.ok || row.diagnosticSchemaVersion !== checked.value.schemaVersion) {
      throw new AgentTraceExportUnavailableError();
    }
    diagnostic = checked.value;
  } else if (row.diagnosticSchemaVersion) throw new AgentTraceExportUnavailableError();
  const event: AgentTraceExportEvent = { id: row.id, sequence: row.sequence,
    eventType: row.eventType, createdAt: row.createdAt };
  for (const key of ["predecessorTraceId", "stepId", "attemptId", "toolReceiptId", "toolCallId",
    "vendorRequestId", "imageArtifactId"] as const) {
    const value = optionalIdentifier(row[key]);
    if (value) event[key] = value;
  }
  for (const key of ["runStatus", "stepStatus"] as const) {
    const value = row[key];
    if (value !== null && value !== undefined) {
      if (!safeIdentifier(value)) throw new AgentTraceExportUnavailableError();
      event[key] = value;
    }
  }
  if (diagnostic) event.diagnostic = diagnostic;
  return event;
}

/** This export is assembled on demand; no separate export blob or provider content is retained. */
export function createAgentTraceEvidenceRuntime(work: DatabaseWork) {
  return {
    async export(input: { projectId: number; runId: string; actorUserId: number }): Promise<AgentTraceExport | null> {
      if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0
        || !Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0
        || !safeIdentifier(input.runId)) throw new AgentTraceExportUnavailableError();
      return work(async (db) => {
        const owner = await db("o_project").where({ id: input.projectId, userId: input.actorUserId }).first("id");
        if (!owner) throw new AgentTraceExportUnavailableError();
        const run = await db("o_agentRun").where({ id: input.runId, projectId: input.projectId }).first("id");
        if (!run) return null;
        const rows = await db("o_agentTrace").where({ runId: input.runId })
          .orderBy("sequence", "asc").limit(MAX_EVENTS + 1);
        if (rows.length > MAX_EVENTS) throw new AgentTraceExportUnavailableError();
        const timeline = auditCausalTraceTimeline(rows);
        if (timeline.linkage === "corrupt") throw new AgentTraceExportUnavailableError();
        const result: AgentTraceExport = { schemaVersion: AGENT_TRACE_EXPORT_SCHEMA_VERSION,
          projectId: input.projectId, runId: input.runId, timeline,
          failureClassification: auditTraceFailureClassification(rows),
          retention: AGENT_EVIDENCE_RETENTION_POLICY,
          redaction: { schemaVersion: TRACE_REDACTION_EVIDENCE_SCHEMA_VERSION, result: "passed" },
          events: rows.map(projectEvent) };
        const inspected = inspectTraceSafePayload(result, { allowedTopLevelKeys: ["schemaVersion", "projectId",
          "runId", "timeline", "failureClassification", "retention", "redaction", "events"], allowedNestedKeys: ["schemaVersion",
          "ordering", "linkage", "eventCount", "coverage", "knownFailureEventCount", "classifiedFailureEventCount",
          "databaseRetention", "databaseDeletion", "mediaDeletion",
          "redactedExportRetention", "result", ...eventKeys, ...diagnosticKeys] });
        if (!inspected.ok) throw new AgentTraceExportUnavailableError();
        return result;
      });
    },
  };
}
