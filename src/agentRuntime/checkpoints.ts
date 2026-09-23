import { createHash } from "node:crypto";

export const AGENT_RUN_CHECKPOINT_SCHEMA_VERSION = "toonflow.agent-run-checkpoint.v1" as const;
export const AGENT_RUN_CHECKPOINT_KINDS = [
  "run-created", "attempt-created", "model-call-intent", "vendor-request-intent", "provider-task-observed", "step-committed",
] as const;
export type AgentRunCheckpointKind = (typeof AGENT_RUN_CHECKPOINT_KINDS)[number];

interface CheckpointEnvelope {
  schemaVersion: typeof AGENT_RUN_CHECKPOINT_SCHEMA_VERSION;
  runId: string;
  stepId: string;
  attemptId: string;
  sequence: number;
  runVersion: number;
  lastCommittedStepId: string | null;
  predecessorCheckpointId: string | null;
  predecessorPayloadHash: string | null;
}

export type AgentRunCheckpointPayload = CheckpointEnvelope & (
  | { kind: "run-created"; requestFingerprint: string }
  | { kind: "attempt-created"; reason: string; predecessorAttemptId: string }
  | { kind: "model-call-intent"; invocationFingerprint: string; resolvedTargetFingerprint: string }
  | { kind: "vendor-request-intent"; requestId: string; scopeHash: string }
  | { kind: "provider-task-observed"; requestId: string; providerTaskId: string }
  | { kind: "step-committed"; outputId: string; outputContentHash: string }
);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

export function canonicalCheckpointPayload(payload: AgentRunCheckpointPayload): string {
  return JSON.stringify(canonicalize(payload));
}

export function hashCheckpointPayload(payload: AgentRunCheckpointPayload): string {
  return createHash("sha256").update(canonicalCheckpointPayload(payload)).digest("hex");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function parseCheckpointPayload(value: unknown, expectedKind?: AgentRunCheckpointKind): AgentRunCheckpointPayload | null {
  if (typeof value !== "string") return null;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (!(AGENT_RUN_CHECKPOINT_KINDS as readonly unknown[]).includes(record.kind)
    || (expectedKind !== undefined && record.kind !== expectedKind)
    || record.schemaVersion !== AGENT_RUN_CHECKPOINT_SCHEMA_VERSION
    || typeof record.runId !== "string" || typeof record.stepId !== "string" || typeof record.attemptId !== "string"
    || !Number.isInteger(record.sequence) || !Number.isInteger(record.runVersion)
    || !isNullableString(record.lastCommittedStepId) || !isNullableString(record.predecessorCheckpointId)
    || !isNullableString(record.predecessorPayloadHash)) return null;
  const common = {
    schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, runId: record.runId, stepId: record.stepId,
    attemptId: record.attemptId, sequence: record.sequence as number, runVersion: record.runVersion as number,
    lastCommittedStepId: record.lastCommittedStepId, predecessorCheckpointId: record.predecessorCheckpointId,
    predecessorPayloadHash: record.predecessorPayloadHash,
  };
  switch (record.kind) {
    case "run-created": return typeof record.requestFingerprint === "string"
      ? { ...common, kind: record.kind, requestFingerprint: record.requestFingerprint } : null;
    case "attempt-created": return typeof record.predecessorAttemptId === "string" && typeof record.reason === "string"
      ? { ...common, kind: record.kind, predecessorAttemptId: record.predecessorAttemptId, reason: record.reason } : null;
    case "model-call-intent": return typeof record.invocationFingerprint === "string" && typeof record.resolvedTargetFingerprint === "string"
      ? { ...common, kind: record.kind, invocationFingerprint: record.invocationFingerprint, resolvedTargetFingerprint: record.resolvedTargetFingerprint } : null;
    case "vendor-request-intent": return typeof record.requestId === "string" && typeof record.scopeHash === "string"
      ? { ...common, kind: record.kind, requestId: record.requestId, scopeHash: record.scopeHash } : null;
    case "provider-task-observed": return typeof record.requestId === "string" && typeof record.providerTaskId === "string"
      ? { ...common, kind: record.kind, requestId: record.requestId, providerTaskId: record.providerTaskId } : null;
    case "step-committed": return typeof record.outputContentHash === "string" && typeof record.outputId === "string"
      ? { ...common, kind: record.kind, outputContentHash: record.outputContentHash, outputId: record.outputId } : null;
    default: return null;
  }
}
