import { createHash } from "node:crypto";

import { tool } from "ai";
import type { Knex } from "knex";
import { v4 as uuid } from "uuid";
import { z } from "zod";

import type { DatabaseWork } from "@/database";
import { createContextBuilder } from "@/context";
import { estimateContextTokens } from "@/context/budget";
import {
  inspectPersistableText,
  projectTraceSafeDiagnostic,
  type TraceSafeDiagnostic,
  type TraceSafeDiagnosticInput,
  validateTraceSafeDiagnostic,
} from "@/diagnostics/traceSafeDiagnostics";
import type { AIMessage } from "@/socket/chatMessagesData";
import { getDefaultConfiguredVendor, type ConfiguredTextCall, type TextModelTarget } from "@/vendor";
import { getDatabaseRuntime } from "@/database";
import {
  createControlledToolRuntime,
  TOOL_DEFINITIONS,
  HARNESS_TOOL_DEFINITIONS,
  SCRIPT_PROPOSAL_TOOL_DEFINITIONS,
  toolDefinitionContractHash,
  type ControlledToolName,
  type ControlledToolDependencies,
} from "@/controlledTools";

import {
  assertAgentRunStepTransition,
  assertAgentRunTransition,
  AgentRunStateConflictError,
  parseAgentRunStatus,
  parseAgentRunStepStatus,
  type AgentRunStatus,
  type AgentRunStepStatus,
} from "./lifecycle";
import {
  AGENT_RUN_CHECKPOINT_KINDS,
  AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
  canonicalCheckpointPayload,
  hashCheckpointPayload,
  parseCheckpointPayload,
  type AgentRunCheckpointKind,
  type AgentRunCheckpointPayload,
} from "./checkpoints";
import { appendCausalTrace, auditCausalTraceTimeline, type TraceTimelineEvidence } from "./causalTrace";
import {
  DEFAULT_AGENT_RUN_LEASE_MS,
  AgentRunLeaseLostError,
  assertAgentRunLease,
  claimAgentRunLease,
  renewAgentRunLease,
  type AgentRunLease,
} from "./lease";

export * from "./lifecycle";
export * from "./checkpoints";
export * from "./lease";

export const AGENT_RUN_START_SCHEMA_VERSION = "toonflow.agent-run.start.v1" as const;
export const AGENT_RUN_OUTPUT_SCHEMA_VERSION = "toonflow.agent-run-output.v1" as const;
export const READ_ONLY_AGENT_ROLE = "scriptAgent" as const;
export const READ_ONLY_AGENT_SCOPE = "read-only-project-guidance-v1" as const;
export const SCRIPT_HARNESS_SCOPE = "script-harness-guidance-v1" as const;
const LOGICAL_TARGET: TextModelTarget = { kind: "logical", key: "scriptAgent:decisionAgent" };
const PROMPT_VERSION = "toonflow.read-only-project-guidance.v1";
const DEFAULT_PROCESS_EPOCH = uuid();
const SYSTEM_PROMPT = [
  "你是 Toonflow 的只读项目顾问。",
  "只能依据给出的项目事实和受控只读工具结果回答用户，不得声称已修改项目。",
  "需要章节原文或事件时，只能调用 get_novel_text 或 get_novel_events；不得猜测其他项目的数据。",
  "当事实不足时明确说明缺少信息。",
].join("\n");
const SCRIPT_PROPOSAL_PROMPT_VERSION = "toonflow.script-proposal-guidance.v1";
const SCRIPT_PROPOSAL_SYSTEM_PROMPT = [SYSTEM_PROMPT,
  "若 Tool 权限允许，你可以提出单字段规划或单个剧本的待审批候选。提案不会写入 Project，只有 Owner 查看全文并批准后才可能生效。",
  "只能报告提案处于待审批状态，不得把提案或模型输出表述为已批准、已保存或已生成成品。",
].join("\n");

export interface StartAgentRunInput {
  schemaVersion: typeof AGENT_RUN_START_SCHEMA_VERSION;
  projectId: number;
  role: typeof READ_ONLY_AGENT_ROLE;
  scope: typeof READ_ONLY_AGENT_SCOPE | typeof SCRIPT_HARNESS_SCOPE;
  clientRequestId: string;
  content: string;
  actorUserId?: number;
}

export interface InspectAgentRunInput {
  runId: string;
  projectId: number;
  actorUserId?: number;
}

export interface CancelAgentRunInput extends InspectAgentRunInput {
  clientCommandId: string;
  expectedVersion: number;
}

export interface ListAgentRunsInput {
  projectId: number;
  role: typeof READ_ONLY_AGENT_ROLE;
  scope: typeof READ_ONLY_AGENT_SCOPE | typeof SCRIPT_HARNESS_SCOPE;
  actorUserId?: number;
}

export interface AgentRunListSnapshot {
  current: AgentRunSnapshot | null;
  recent: AgentRunSnapshot[];
}

export interface AgentRunStepSnapshot {
  id: string;
  ordinal: number;
  kind: "model";
  status: AgentRunStepStatus;
  logicalTarget: TextModelTarget;
  resolvedTarget?: ConfiguredTextCall["target"];
  promptFingerprint: string;
  startedAt?: number;
  completedAt?: number;
}

export interface AgentRunOutputSnapshot {
  id: string;
  stepId: string;
  kind: "assistant-text";
  content: string;
  contentHash: string;
  schemaVersion: typeof AGENT_RUN_OUTPUT_SCHEMA_VERSION;
  createdAt: number;
}

export interface AgentTraceSnapshot {
  id: string;
  stepId?: string;
  attemptId?: string;
  toolReceiptId?: string;
  toolCallId?: string;
  vendorRequestId?: string;
  imageArtifactId?: string;
  predecessorTraceId?: string;
  sequence: number;
  eventType: string;
  runStatus?: AgentRunStatus;
  stepStatus?: AgentRunStepStatus;
  diagnostic?: TraceSafeDiagnostic;
  createdAt: number;
}

export type AgentRunAttemptStatus = "preparing" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
export type AgentRunAttemptReason = "initial" | "restart-recovery";

export interface AgentRunAttemptSnapshot {
  id: string;
  stepId: string;
  ordinal: number;
  predecessorAttemptId?: string;
  reason: AgentRunAttemptReason;
  status: AgentRunAttemptStatus;
  resolvedTarget?: ConfiguredTextCall["target"];
  invocationFingerprint?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface AgentRunCheckpointSnapshot {
  id: string;
  stepId: string;
  attemptId: string;
  sequence: number;
  kind: AgentRunCheckpointKind;
  schemaVersion: typeof AGENT_RUN_CHECKPOINT_SCHEMA_VERSION;
  runVersion: number;
  lastCommittedStepId?: string;
  predecessorCheckpointId?: string;
  payloadHash: string;
  createdAt: number;
}

export interface AgentRunSnapshot {
  id: string;
  projectId: number;
  role: typeof READ_ONLY_AGENT_ROLE;
  scope: typeof READ_ONLY_AGENT_SCOPE | typeof SCRIPT_HARNESS_SCOPE;
  clientRequestId: string;
  requestFingerprint: string;
  status: AgentRunStatus;
  waitingReason?: string;
  attentionReason?: string;
  allowedActions: readonly string[];
  version: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  lastCommittedStepId?: string;
  leaseFence: number;
  leaseExpiresAt?: number;
  cancellationRequestedAt?: number;
  cancellationCommandId?: string;
  steps: AgentRunStepSnapshot[];
  attempts: AgentRunAttemptSnapshot[];
  checkpoints: AgentRunCheckpointSnapshot[];
  outputs: AgentRunOutputSnapshot[];
  traceEvidence: TraceTimelineEvidence;
  traces: AgentTraceSnapshot[];
}

export interface AgentRuntime {
  start(input: StartAgentRunInput): Promise<AgentRunSnapshot>;
  inspect(input: InspectAgentRunInput): Promise<AgentRunSnapshot | null>;
  cancel(input: CancelAgentRunInput): Promise<AgentRunSnapshot | null>;
  list(input: ListAgentRunsInput): Promise<AgentRunListSnapshot>;
}

export interface AgentRunDependencies {
  work: DatabaseWork;
  openTextCall(target: TextModelTarget): Promise<ConfiguredTextCall>;
  schedule(work: () => Promise<void>): void;
  now(): number;
  createId(): string;
  workerId?: string;
  processEpoch?: string;
  leaseDurationMs?: number;
  controlledTools?: ReturnType<typeof createControlledToolRuntime>;
  prepareRun?: (tx: Knex.Transaction, input: { runId: string; projectId: number;
    role: typeof READ_ONLY_AGENT_ROLE; content: string; createdAt: number;
    actorUserId?: number }) => Promise<void>;
  skillMode?: { grants: NonNullable<ControlledToolDependencies["skillGrants"]> };
  proposeScriptWrite?: (input: { projectId: number; parentRunId: string;
    skillId: string; lease: AgentRunLease; operationId: string;
    kind: "workspace" | "script"; payload: unknown }) => Promise<
      { status: "denied" } | { status: "pending"; approvalRunId: string; approvalId: string }>;
}

export class AgentRunConflictError extends Error {
  constructor() {
    super("clientRequestId 已被不同请求使用");
    this.name = "AgentRunConflictError";
  }
}

export class AgentRunCommandConflictError extends Error {
  constructor() {
    super("clientCommandId 已被不同命令使用");
    this.name = "AgentRunCommandConflictError";
  }
}

export class AgentRunVersionConflictError extends Error {
  constructor() {
    super("Agent Run 版本已变化，请刷新后重试");
    this.name = "AgentRunVersionConflictError";
  }
}

export class AgentRunProjectNotFoundError extends Error {
  constructor(projectId: number) {
    super(`Project ${projectId} 不存在`);
    this.name = "AgentRunProjectNotFoundError";
  }
}

export class AgentRunContentRejectedError extends Error {
  constructor(readonly violationCodes: readonly string[]) {
    super("Agent Run 内容包含不可持久化的敏感材料");
    this.name = "AgentRunContentRejectedError";
  }
}

export class AgentRunEvidenceCorruptError extends Error {
  constructor() {
    super("Agent Run 持久化证据不符合安全契约");
    this.name = "AgentRunEvidenceCorruptError";
  }
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseTraceDiagnostic(value: unknown): TraceSafeDiagnostic {
  if (typeof value !== "string") throw new AgentRunEvidenceCorruptError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AgentRunEvidenceCorruptError();
  }
  const validated = validateTraceSafeDiagnostic(parsed, "trace");
  if (!validated.ok) throw new AgentRunEvidenceCorruptError();
  return validated.value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function parseAttemptStatus(value: unknown): AgentRunAttemptStatus {
  if (["preparing", "running", "waiting", "succeeded", "failed", "cancelled"].includes(String(value))) {
    return value as AgentRunAttemptStatus;
  }
  throw new AgentRunEvidenceCorruptError();
}

function parseAttemptReason(value: unknown): AgentRunAttemptReason {
  if (value === "initial" || value === "restart-recovery") return value;
  throw new AgentRunEvidenceCorruptError();
}

function validateCheckpointRows(rows: any[]): Array<any & { parsedPayload: AgentRunCheckpointPayload }> {
  let predecessorCheckpointId: string | null = null;
  let predecessorPayloadHash: string | null = null;
  let previousRunVersion = 0;
  return rows.map((row, index) => {
    if (row.sequence !== index + 1
      || row.schemaVersion !== AGENT_RUN_CHECKPOINT_SCHEMA_VERSION
      || !(AGENT_RUN_CHECKPOINT_KINDS as readonly unknown[]).includes(row.kind)
      || (row.predecessorCheckpointId ?? null) !== predecessorCheckpointId
      || !Number.isInteger(row.runVersion) || row.runVersion <= previousRunVersion) {
      throw new AgentRunEvidenceCorruptError();
    }
    const parsedPayload = parseCheckpointPayload(row.payload, row.kind as AgentRunCheckpointKind);
    if (!parsedPayload || canonicalCheckpointPayload(parsedPayload) !== row.payload
      || hashCheckpointPayload(parsedPayload) !== row.payloadHash
      || parsedPayload.runId !== row.runId || parsedPayload.stepId !== row.stepId
      || parsedPayload.attemptId !== row.attemptId || parsedPayload.sequence !== row.sequence
      || parsedPayload.runVersion !== row.runVersion
      || parsedPayload.lastCommittedStepId !== (row.lastCommittedStepId ?? null)
      || parsedPayload.predecessorCheckpointId !== (row.predecessorCheckpointId ?? null)
      || parsedPayload.predecessorPayloadHash !== predecessorPayloadHash) {
      throw new AgentRunEvidenceCorruptError();
    }
    predecessorCheckpointId = row.id;
    predecessorPayloadHash = row.payloadHash;
    previousRunVersion = row.runVersion;
    return { ...row, parsedPayload };
  });
}

function validateCheckpointEvidence(run: any, steps: any[], attempts: any[], outputs: any[], checkpoints: Array<any & { parsedPayload: AgentRunCheckpointPayload }>): void {
  const stepIds = new Set(steps.map((step) => step.id));
  const attemptById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  const outputById = new Map(outputs.map((output) => [output.id, output]));
  const attemptGroups = new Map<string, any[]>();
  for (const attempt of attempts) {
    const group = attemptGroups.get(attempt.stepId) ?? [];
    group.push(attempt);
    attemptGroups.set(attempt.stepId, group);
  }
  for (const [stepId, group] of attemptGroups) {
    if (!stepIds.has(stepId)) throw new AgentRunEvidenceCorruptError();
    group.sort((left, right) => left.ordinal - right.ordinal);
    group.forEach((attempt, index) => {
      if (attempt.runId !== run.id || attempt.ordinal !== index + 1
        || (attempt.predecessorAttemptId ?? null) !== (index === 0 ? null : group[index - 1].id)) {
        throw new AgentRunEvidenceCorruptError();
      }
    });
  }
  checkpoints.forEach((checkpoint, index) => {
    const payload = checkpoint.parsedPayload;
    const attempt = attemptById.get(checkpoint.attemptId);
    if (!stepIds.has(checkpoint.stepId) || !attempt || attempt.stepId !== checkpoint.stepId) throw new AgentRunEvidenceCorruptError();
    if ((index === 0) !== (payload.kind === "run-created")) throw new AgentRunEvidenceCorruptError();
    if (payload.kind === "run-created" && payload.requestFingerprint !== run.requestFingerprint) {
      throw new AgentRunEvidenceCorruptError();
    }
    if (payload.kind === "attempt-created"
      && (attempt.predecessorAttemptId !== payload.predecessorAttemptId || attempt.reason !== payload.reason)) {
      throw new AgentRunEvidenceCorruptError();
    }
    if (payload.kind === "model-call-intent") {
      const target = parseJson<ConfiguredTextCall["target"] | null>(attempt.resolvedTarget, null);
      if (!target || attempt.invocationFingerprint !== payload.invocationFingerprint
        || fingerprint(target) !== payload.resolvedTargetFingerprint) throw new AgentRunEvidenceCorruptError();
    }
    if (payload.kind === "step-committed") {
      const output = outputById.get(payload.outputId);
      if (!output || output.stepId !== checkpoint.stepId || output.contentHash !== payload.outputContentHash
        || fingerprint(output.content) !== output.contentHash || output.schemaVersion !== AGENT_RUN_OUTPUT_SCHEMA_VERSION
        || checkpoint.lastCommittedStepId !== checkpoint.stepId) throw new AgentRunEvidenceCorruptError();
    }
  });
  if ((checkpoints.at(-1)?.lastCommittedStepId ?? null) !== (run.lastCommittedStepId ?? null)) {
    throw new AgentRunEvidenceCorruptError();
  }
}

function validateOutputs(outputs: any[]): void {
  for (const output of outputs) {
    if (output.schemaVersion !== AGENT_RUN_OUTPUT_SCHEMA_VERSION
      || fingerprint(output.content) !== output.contentHash
      || !inspectPersistableText(output.content).ok) {
      throw new AgentRunEvidenceCorruptError();
    }
  }
}

async function readSnapshot(db: Knex | Knex.Transaction, runId: string, projectId: number): Promise<AgentRunSnapshot | null> {
  const run = await db("o_agentRun").where({ id: runId, projectId }).first();
  if (!run) return null;
  const [steps, attempts, checkpointRows, outputs, traces] = await Promise.all([
    db("o_agentRunStep").where("runId", runId).orderBy("ordinal", "asc"),
    db("o_agentRunAttempt").where("runId", runId).orderBy([{ column: "createdAt", order: "asc" }, { column: "ordinal", order: "asc" }]),
    db("o_agentRunCheckpoint").where("runId", runId).orderBy("sequence", "asc"),
    db("o_agentRunOutput").where("runId", runId).orderBy("createdAt", "asc"),
    db("o_agentTrace").where("runId", runId).orderBy("sequence", "asc"),
  ]);
  const traceEvidence = auditCausalTraceTimeline(traces);
  const quarantinedEvidence = run.attentionReason === "agent-checkpoint-corrupt"
    || run.attentionReason === "agent-checkpoint-incompatible";
  const checkpoints = quarantinedEvidence ? [] : validateCheckpointRows(checkpointRows);
  if (!quarantinedEvidence) {
    validateOutputs(outputs);
    const legacyEvidence = checkpoints.length === 0 && attempts.length === 0;
    if (legacyEvidence) {
      if (!["succeeded", "failed", "cancelled"].includes(run.status) || run.lastCommittedStepId) {
        throw new AgentRunEvidenceCorruptError();
      }
    } else {
      if (checkpoints.length === 0 || attempts.length === 0) throw new AgentRunEvidenceCorruptError();
      const checkpointVersion = checkpoints.at(-1)!.runVersion;
      // Lease claims and commands advance the Run revision without claiming a
      // new execution checkpoint; only backwards checkpoint versions are invalid.
      if (checkpointVersion > run.version) throw new AgentRunEvidenceCorruptError();
      validateCheckpointEvidence(run, steps, attempts, outputs, checkpoints);
    }
  }
  return {
    id: run.id,
    projectId: run.projectId,
    role: run.role,
    scope: run.scope,
    clientRequestId: run.clientRequestId,
    requestFingerprint: run.requestFingerprint,
    status: parseAgentRunStatus(run.status),
    ...(run.waitingReason ? { waitingReason: run.waitingReason } : {}),
    ...(run.attentionReason ? { attentionReason: run.attentionReason } : {}),
    allowedActions: parseJson<string[]>(run.allowedActions, ["inspect"]),
    version: run.version,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(optionalNumber(run.startedAt) !== undefined ? { startedAt: run.startedAt } : {}),
    ...(optionalNumber(run.completedAt) !== undefined ? { completedAt: run.completedAt } : {}),
    ...(run.lastCommittedStepId ? { lastCommittedStepId: run.lastCommittedStepId } : {}),
    leaseFence: Number(run.fence ?? 0),
    ...(optionalNumber(run.leaseExpiresAt) !== undefined ? { leaseExpiresAt: run.leaseExpiresAt } : {}),
    ...(optionalNumber(run.cancellationRequestedAt) !== undefined ? { cancellationRequestedAt: run.cancellationRequestedAt } : {}),
    ...(run.cancellationCommandId ? { cancellationCommandId: run.cancellationCommandId } : {}),
    steps: steps.map((step) => ({
      id: step.id,
      ordinal: step.ordinal,
      kind: step.kind,
      status: parseAgentRunStepStatus(step.status),
      logicalTarget: parseJson<TextModelTarget>(step.logicalTarget, LOGICAL_TARGET),
      ...(step.resolvedTarget ? { resolvedTarget: parseJson<ConfiguredTextCall["target"]>(step.resolvedTarget, undefined as never) } : {}),
      promptFingerprint: step.promptFingerprint,
      ...(optionalNumber(step.startedAt) !== undefined ? { startedAt: step.startedAt } : {}),
      ...(optionalNumber(step.completedAt) !== undefined ? { completedAt: step.completedAt } : {}),
    })),
    attempts: (quarantinedEvidence ? [] : attempts).map((attempt) => ({
      id: attempt.id,
      stepId: attempt.stepId,
      ordinal: attempt.ordinal,
      ...(attempt.predecessorAttemptId ? { predecessorAttemptId: attempt.predecessorAttemptId } : {}),
      reason: parseAttemptReason(attempt.reason),
      status: parseAttemptStatus(attempt.status),
      ...(attempt.resolvedTarget ? { resolvedTarget: parseJson<ConfiguredTextCall["target"]>(attempt.resolvedTarget, undefined as never) } : {}),
      ...(attempt.invocationFingerprint ? { invocationFingerprint: attempt.invocationFingerprint } : {}),
      createdAt: attempt.createdAt,
      ...(optionalNumber(attempt.startedAt) !== undefined ? { startedAt: attempt.startedAt } : {}),
      ...(optionalNumber(attempt.completedAt) !== undefined ? { completedAt: attempt.completedAt } : {}),
    })),
    checkpoints: checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      stepId: checkpoint.stepId,
      attemptId: checkpoint.attemptId,
      sequence: checkpoint.sequence,
      kind: checkpoint.kind,
      schemaVersion: checkpoint.schemaVersion,
      runVersion: checkpoint.runVersion,
      ...(checkpoint.lastCommittedStepId ? { lastCommittedStepId: checkpoint.lastCommittedStepId } : {}),
      ...(checkpoint.predecessorCheckpointId ? { predecessorCheckpointId: checkpoint.predecessorCheckpointId } : {}),
      payloadHash: checkpoint.payloadHash,
      createdAt: checkpoint.createdAt,
    })),
    outputs: (quarantinedEvidence ? [] : outputs).map((output) => ({
      id: output.id,
      stepId: output.stepId,
      kind: output.kind,
      content: output.content,
      contentHash: output.contentHash,
      schemaVersion: output.schemaVersion,
      createdAt: output.createdAt,
    })),
    traceEvidence,
    traces: (traceEvidence.linkage === "corrupt" ? [] : traces).map((trace) => ({
      id: trace.id,
      ...(trace.stepId ? { stepId: trace.stepId } : {}),
      ...(trace.attemptId ? { attemptId: trace.attemptId } : {}),
      ...(trace.toolReceiptId ? { toolReceiptId: trace.toolReceiptId } : {}),
      ...(trace.toolCallId ? { toolCallId: trace.toolCallId } : {}),
      ...(trace.vendorRequestId ? { vendorRequestId: trace.vendorRequestId } : {}),
      ...(trace.imageArtifactId ? { imageArtifactId: trace.imageArtifactId } : {}),
      ...(trace.predecessorTraceId ? { predecessorTraceId: trace.predecessorTraceId } : {}),
      sequence: trace.sequence,
      eventType: trace.eventType,
      ...(trace.runStatus ? { runStatus: parseAgentRunStatus(trace.runStatus) } : {}),
      ...(trace.stepStatus ? { stepStatus: parseAgentRunStepStatus(trace.stepStatus) } : {}),
      ...(trace.diagnostic ? { diagnostic: parseTraceDiagnostic(trace.diagnostic) } : {}),
      createdAt: trace.createdAt,
    })),
  };
}

type FailureFacts = Omit<TraceSafeDiagnosticInput, "cause">;

class ClassifiedAgentRunError extends Error {
  constructor(readonly facts: FailureFacts, cause: unknown) {
    super("Agent Run execution failed", { cause });
    this.name = "ClassifiedAgentRunError";
  }
}

function projectFailure(error: unknown): TraceSafeDiagnostic {
  const fallbackFacts: FailureFacts = {
    failureClass: "Vendor",
    stage: "vendor-request",
    kind: "executionFailed",
    severity: "error",
    certainty: "unknown-effect",
    expectedness: "unexpected",
    retryDisposition: "reconcile-first",
  };
  const facts = error instanceof ClassifiedAgentRunError ? error.facts : fallbackFacts;
  const cause = error instanceof ClassifiedAgentRunError ? error.cause : error;
  const projected = projectTraceSafeDiagnostic(
    {
      ...facts,
      cause,
    },
    "trace",
  );
  if (projected.ok) return projected.value;
  const fallback = projectTraceSafeDiagnostic(
    facts,
    "trace",
  );
  if (!fallback.ok) throw new Error("Trace-safe diagnostic fallback failed");
  return fallback.value;
}

export function createAgentRuntime(dependencies: AgentRunDependencies): AgentRuntime {
  if (dependencies.skillMode && (!dependencies.prepareRun || dependencies.controlledTools)) {
    throw new TypeError("Skill mode requires atomic preparation and its own guarded Tool runtime");
  }
  if (dependencies.proposeScriptWrite && !dependencies.skillMode) {
    throw new TypeError("Script proposal Tools require guarded Skill mode");
  }
  const workerId = dependencies.workerId ?? uuid();
  const processEpoch = dependencies.processEpoch ?? DEFAULT_PROCESS_EPOCH;
  const leaseDurationMs = dependencies.leaseDurationMs ?? DEFAULT_AGENT_RUN_LEASE_MS;
  const controlledTools = dependencies.controlledTools ?? createControlledToolRuntime({
    work: dependencies.work, now: dependencies.now, createId: dependencies.createId,
    ...(dependencies.skillMode ? { skillGrants: dependencies.skillMode.grants } : {}),
  });
  async function inspect(input: InspectAgentRunInput): Promise<AgentRunSnapshot | null> {
    return dependencies.work(async (db) => {
      const run = await db("o_agentRun").where({ id: input.runId,
        projectId: input.projectId }).first("scope");
      if (!run) return null;
      if (run.scope === SCRIPT_HARNESS_SCOPE
        && (!Number.isSafeInteger(input.actorUserId) || input.actorUserId! <= 0
          || !await db("o_project").where({ id: input.projectId,
            userId: input.actorUserId }).first("id"))) return null;
      return readSnapshot(db, input.runId, input.projectId);
    });
  }

  async function list(input: ListAgentRunsInput): Promise<AgentRunListSnapshot> {
    if (!Number.isInteger(input.projectId) || input.projectId <= 0
      || input.role !== READ_ONLY_AGENT_ROLE
      || ![READ_ONLY_AGENT_SCOPE, SCRIPT_HARNESS_SCOPE].includes(input.scope)) {
      throw new TypeError("Agent Run 列表范围无效");
    }
    return dependencies.work(async (db) => {
      if (input.scope === SCRIPT_HARNESS_SCOPE
        && (!Number.isSafeInteger(input.actorUserId) || input.actorUserId! <= 0
          || !await db("o_project").where({ id: input.projectId,
            userId: input.actorUserId }).first("id"))) {
        return { current: null, recent: [] };
      }
      const scope = { projectId: input.projectId, role: input.role, scope: input.scope };
      const [recentRows, currentRow] = await Promise.all([
        db("o_agentRun").where(scope).orderBy("createdAt", "desc").orderBy("id", "desc").limit(20).select("id"),
        db("o_agentRun").where(scope).whereIn("status", ["queued", "running", "waiting"])
          .orderBy("createdAt", "desc").orderBy("id", "desc").first("id"),
      ]);
      const recent = await Promise.all(recentRows.map((row: { id: string }) => readSnapshot(db, row.id, input.projectId)));
      const current = currentRow
        ? recent.find((run) => run?.id === currentRow.id) ?? await readSnapshot(db, currentRow.id, input.projectId)
        : recent[0] ?? null;
      return { current, recent: recent.filter((run): run is AgentRunSnapshot => run !== null) };
    });
  }

  async function cancel(input: CancelAgentRunInput): Promise<AgentRunSnapshot | null> {
    const clientCommandId = input.clientCommandId.trim();
    if (!input.runId || !Number.isInteger(input.projectId) || input.projectId <= 0
      || !clientCommandId || clientCommandId.length > 128
      || !Number.isInteger(input.expectedVersion) || input.expectedVersion <= 0) {
      throw new TypeError("Agent Run 取消命令无效");
    }
    const inputFingerprint = fingerprint({
      kind: "cancel", runId: input.runId, projectId: input.projectId,
      clientCommandId, expectedVersion: input.expectedVersion,
    });
    return dependencies.work((db) => db.transaction(async (trx) => {
      const run = await trx("o_agentRun").where({ id: input.runId, projectId: input.projectId }).first();
      if (!run) return null;
      if (run.scope === SCRIPT_HARNESS_SCOPE
        && (!Number.isSafeInteger(input.actorUserId) || input.actorUserId! <= 0
          || !await trx("o_project").where({ id: input.projectId,
            userId: input.actorUserId }).first("id"))) return null;
      const previous = await trx("o_agentRunCommand").where({ runId: run.id, clientCommandId }).first();
      if (previous) {
        if (previous.inputFingerprint !== inputFingerprint) throw new AgentRunCommandConflictError();
        return readSnapshot(trx, run.id, input.projectId);
      }
      if (run.version !== input.expectedVersion) throw new AgentRunVersionConflictError();
      if (run.cancellationRequestedAt) throw new AgentRunVersionConflictError();
      if (["succeeded", "failed", "cancelled"].includes(run.status)) {
        throw new AgentRunStateConflictError("Run", run.status, "cancelled");
      }
      if (run.status === "waiting") throw new AgentRunStateConflictError("Run", "waiting", "cancelled");
      const now = dependencies.now();
      const safeBeforeCall = run.status === "queued";
      const nextStatus = safeBeforeCall ? "cancelled" : run.status;
      const nextVersion = run.version + 1;
      const changed = await trx("o_agentRun")
        .where({ id: run.id, projectId: input.projectId, status: run.status, version: run.version })
        .update({
          status: nextStatus,
          version: nextVersion,
          updatedAt: now,
          cancellationRequestedAt: now,
          cancellationCommandId: clientCommandId,
          allowedActions: JSON.stringify(["inspect"]),
          ...(safeBeforeCall ? {
            completedAt: now, leaseOwnerId: null, leaseEpoch: null, leaseExpiresAt: null,
          } : {}),
        });
      if (changed !== 1) throw new AgentRunVersionConflictError();
      if (safeBeforeCall) {
        const step = await trx("o_agentRunStep").where({ runId: run.id, status: "pending" }).first();
        if (!step) throw new Error("Agent Run 取消缺少待执行 Step");
        const changedStep = await trx("o_agentRunStep").where({ id: step.id, status: "pending" })
          .update({ status: "cancelled", completedAt: now });
        const changedAttempt = await trx("o_agentRunAttempt").where({ runId: run.id, stepId: step.id, status: "preparing" })
          .update({ status: "cancelled", completedAt: now });
        if (changedStep !== 1 || changedAttempt !== 1) throw new Error("Agent Run 取消缺少唯一待执行 Step/Attempt");
      }
      await trx("o_agentRunCommand").insert({
        id: dependencies.createId(), runId: run.id, clientCommandId, kind: "cancel", inputFingerprint,
        expectedVersion: input.expectedVersion, resultVersion: nextVersion, createdAt: now,
      });
      const traceStep = await trx("o_agentRunStep").where({ runId: run.id }).orderBy("ordinal", "desc").first("id");
      const traceAttempt = traceStep && await trx("o_agentRunAttempt")
        .where({ runId: run.id, stepId: traceStep.id }).orderBy("ordinal", "desc").first("id");
      await appendCausalTrace(trx, {
        id: dependencies.createId(), runId: run.id,
        ...(traceStep ? { stepId: traceStep.id } : {}),
        ...(traceAttempt ? { attemptId: traceAttempt.id } : {}),
        eventType: safeBeforeCall ? "run.cancelled" : "run.cancellation-requested",
        runStatus: nextStatus, ...(safeBeforeCall ? { stepStatus: "cancelled" } : {}), createdAt: now,
      });
      return readSnapshot(trx, run.id, input.projectId);
    }));
  }

  async function settleFailure(runId: string, stepId: string, attemptId: string, lease: AgentRunLease, intentCommitted: boolean, error: unknown): Promise<void> {
    const diagnostic = projectFailure(error);
    const now = dependencies.now();
    await dependencies.work((db) => db.transaction(async (trx) => {
      await assertAgentRunLease(trx, lease, now);
      const run = await trx("o_agentRun").where("id", runId).first();
      if (!run || !["queued", "running"].includes(run.status)) return;
      const step = await trx("o_agentRunStep").where("id", stepId).first();
      if (!step || !["pending", "running"].includes(step.status)) return;
      const attempt = await trx("o_agentRunAttempt").where("id", attemptId).first();
      if (!attempt || !["preparing", "running"].includes(attempt.status)) return;
      const runStatus = parseAgentRunStatus(run.status);
      const stepStatus = parseAgentRunStepStatus(step.status);
      const targetStatus = intentCommitted ? "waiting" : "failed";
      assertAgentRunTransition(runStatus, targetStatus);
      assertAgentRunStepTransition(stepStatus, targetStatus);
      const changedAttempt = await trx("o_agentRunAttempt").where({ id: attemptId, status: attempt.status }).update({
        status: targetStatus,
        ...(intentCommitted ? {} : { completedAt: now }),
      });
      const changedStep = await trx("o_agentRunStep").where({ id: stepId, status: stepStatus }).update({
        status: targetStatus,
        ...(intentCommitted ? {} : { completedAt: now }),
      });
      const changedRun = await trx("o_agentRun").where({
        id: runId, status: runStatus, version: run.version,
        leaseOwnerId: lease.ownerId, leaseEpoch: lease.epoch, fence: lease.fence,
      }).where("leaseExpiresAt", ">", now).update({
        status: targetStatus,
        waitingReason: intentCommitted ? "model-call-outcome-unknown" : null,
        attentionReason: intentCommitted ? "model-call-outcome-unknown" : null,
        allowedActions: JSON.stringify(["inspect"]),
        failureDiagnostic: JSON.stringify(diagnostic),
        ...(intentCommitted ? {} : { completedAt: now }),
        updatedAt: now,
        version: run.version + 1,
        leaseOwnerId: null,
        leaseEpoch: null,
        leaseExpiresAt: null,
      });
      if (changedAttempt !== 1 || changedStep !== 1 || changedRun !== 1) throw new Error("Agent Run 失败状态提交发生并发冲突");
      await appendCausalTrace(trx, {
        id: dependencies.createId(),
        runId,
        stepId,
        attemptId,
        eventType: intentCommitted ? "run.needs-attention" : "run.failed",
        runStatus: targetStatus,
        stepStatus: targetStatus,
        diagnostic,
        createdAt: now,
      });
    }));
  }

  async function execute(runId: string, stepId: string, attemptId: string): Promise<void> {
    const lease = await dependencies.work((db) => claimAgentRunLease(db, {
      runId, ownerId: workerId, epoch: processEpoch, now: dependencies.now(), durationMs: leaseDurationMs,
    }));
    if (!lease) return;
    let heartbeatFailed = false;
    let renewal = Promise.resolve();
    const heartbeat = setInterval(() => {
      renewal = renewal.then(async () => {
        if (heartbeatFailed) return;
        await dependencies.work((db) => renewAgentRunLease(db, lease, dependencies.now(), leaseDurationMs));
      }).catch(() => { heartbeatFailed = true; });
    }, Math.max(1, Math.floor(leaseDurationMs / 3)));
    heartbeat.unref();
    let intentCommitted = false;
    try {
      const prepared = await dependencies.work(async (db) => {
        const run = await db("o_agentRun").where({ id: runId, status: "queued" }).first();
        const step = await db("o_agentRunStep").where({ id: stepId, status: "pending" }).first();
        const attempt = await db("o_agentRunAttempt").where({ id: attemptId, status: "preparing" }).first();
        if (!run || !step || !attempt) return null;
        let skillId: string | undefined;
        if (dependencies.skillMode) {
          const route = await db("o_agentSkillRouteDecision").where({ runId }).first();
          if (!route || createHash("sha256").update(route.decisionJson).digest("hex") !== route.decisionHash) {
            throw new Error("Skill-mode Run routing evidence is missing or corrupt");
          }
          const decision = parseJson<{ status?: string; selected?: { skillId?: string } }>(
            route.decisionJson, {});
          if (decision.status !== "selected" || !decision.selected?.skillId) {
            throw new Error("Skill-mode Run has no unique frozen Skill");
          }
          skillId = decision.selected.skillId;
        }
        return { input: parseJson<{ content: string }>(run.input, { content: "" }),
          projectId: run.projectId, skillId };
      });
      if (!prepared) return;
      const preparedSkillId = prepared.skillId;
      const systemContract = dependencies.proposeScriptWrite
        ? SCRIPT_PROPOSAL_SYSTEM_PROMPT : SYSTEM_PROMPT;
      let call: ConfiguredTextCall;
      try {
        call = await dependencies.openTextCall(LOGICAL_TARGET);
      } catch (error) {
        throw new ClassifiedAgentRunError({
          failureClass: "Vendor", stage: "vendor-request", kind: "executionFailed", severity: "error",
          certainty: "known-no-effect", expectedness: "unexpected", retryDisposition: "safe-retry",
        }, error);
      }
      const invocation: { messages: Array<{ role: "system" | "assistant" | "user"; content: string }> } = { messages: [] };
      if (dependencies.skillMode && call.target.contextWindowTokens === undefined) {
        throw new ClassifiedAgentRunError({ failureClass: "Context", stage: "context-build",
          kind: "contextMissing", severity: "error", certainty: "known-no-effect",
          expectedness: "unexpected", retryDisposition: "never" },
        new Error("Skill mode requires declared Model Context capacity"));
      }
      if (call.target.contextWindowTokens === undefined) {
        // Compatibility path for configured Models that have no declared Context capacity yet.
        let project: { name?: string | null; type?: string | null; intro?: string | null;
          artStyle?: string | null; videoRatio?: string | null } | undefined;
        let chapterRow: { count?: number } | undefined;
        let availableChapters: Array<{ id: number; chapterIndex: number | null }> = [];
        try {
          [project, chapterRow, availableChapters] = await Promise.all([
            dependencies.work((db) => db("o_project").where("id", prepared.projectId).first()),
            dependencies.work((db) => db("o_novel").where("projectId", prepared.projectId).count<{ count: number }[]>("id as count").first()),
            dependencies.work((db) => db("o_novel").where("projectId", prepared.projectId)
              .orderBy("chapterIndex", "asc").orderBy("id", "asc").limit(20).select("id", "chapterIndex")),
          ]);
        } catch (error) {
          throw new ClassifiedAgentRunError({ failureClass: "Context", stage: "context-build", kind: "executionFailed",
            severity: "error", certainty: "known-no-effect", expectedness: "unexpected", retryDisposition: "safe-retry" }, error);
        }
        if (!project) {
          throw new ClassifiedAgentRunError({ failureClass: "Context", stage: "context-build", kind: "contextMissing",
            severity: "error", certainty: "known-no-effect", expectedness: "unexpected", retryDisposition: "never" },
          new AgentRunProjectNotFoundError(prepared.projectId));
        }
        const projectFacts = [
          `项目名称：${project.name ?? "未知"}`, `项目类型：${project.type ?? "未知"}`,
          `项目简介：${project.intro ?? "无"}`, `视觉风格：${project.artStyle ?? "无"}`,
          `视频画幅：${project.videoRatio ?? "16:9"}`, `章节数量：${Number(chapterRow?.count ?? 0)}`,
          `可读取章节记录ID与编号：${availableChapters.map((chapter) => `${chapter.id}:${chapter.chapterIndex ?? "未知"}`).join("、") || "无"}${Number(chapterRow?.count ?? 0) > 20 ? "（仅列前20条）" : ""}`,
        ].join("\n");
        invocation.messages = [{ role: "system", content: systemContract },
          { role: "assistant", content: projectFacts }, { role: "user", content: prepared.input.content }];
      }
      const modelToolDefinitions = dependencies.skillMode
        ? { ...HARNESS_TOOL_DEFINITIONS,
          ...(dependencies.proposeScriptWrite ? SCRIPT_PROPOSAL_TOOL_DEFINITIONS : {}) }
        : TOOL_DEFINITIONS;
      const toolContracts = Object.values(modelToolDefinitions).map((definition) => ({
        name: definition.name, revision: definition.revision, contractHash: toolDefinitionContractHash(definition),
      }));
      let contextBundleHash: string | undefined;
      if (call.target.contextWindowTokens !== undefined) {
        try {
          const toolAndPermissionContract = JSON.stringify(Object.values(modelToolDefinitions).map((definition) => ({
            name: definition.name, revision: definition.revision,
            inputSchema: z.toJSONSchema(definition.inputSchema), policy: definition.policy,
          })));
          const bundle = await createContextBuilder({ work: dependencies.work,
            now: dependencies.now, createId: dependencies.createId }).build({
            runId, stepId, attemptId, projectId: prepared.projectId, role: READ_ONLY_AGENT_ROLE,
            systemContract, stepIntent: prepared.input.content,
            toolAndPermissionContract, modelRevision: `${call.target.vendorId}:${call.target.modelId}`,
            budget: { contextWindowTokens: call.target.contextWindowTokens,
              policyMaxInputTokens: 8_192,
              outputReserveTokens: call.target.maxOutputTokens && call.target.maxOutputTokens > 0
                ? call.target.maxOutputTokens : 2_048,
              toolProtocolReserveTokens: estimateContextTokens(toolAndPermissionContract), risk: "standard" },
            novelIds: [], requiredNovelIds: [], expectedRevisions: {},
            includeBoundSkills: Boolean(dependencies.skillMode),
          });
          invocation.messages = bundle.messages;
          contextBundleHash = bundle.manifestHash;
        } catch (error) {
          throw new ClassifiedAgentRunError({
            failureClass: "Context", stage: "context-build", kind: "executionFailed", severity: "error",
            certainty: "known-no-effect", expectedness: "unexpected", retryDisposition: "safe-retry",
          }, error);
        }
      }
      const invocationFingerprint = fingerprint({ target: call.target, invocation, toolContracts, contextBundleHash });
      try {
        intentCommitted = await dependencies.work((db) => db.transaction(async (trx) => {
          const run = await trx("o_agentRun").where({ id: runId, status: "queued" }).first();
          const step = await trx("o_agentRunStep").where({ id: stepId, status: "pending" }).first();
          const attempt = await trx("o_agentRunAttempt").where({ id: attemptId, status: "preparing" }).first();
          if (!run || !step || !attempt) return false;
          const predecessor = await trx("o_agentRunCheckpoint").where({ runId }).orderBy("sequence", "desc").first();
          if (!predecessor) throw new Error("Agent Run 缺少创建 checkpoint");
          const now = dependencies.now();
          await assertAgentRunLease(trx, lease, now);
          const nextVersion = run.version + 1;
          const checkpointId = dependencies.createId();
          const payload: AgentRunCheckpointPayload = {
            schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, kind: "model-call-intent", runId, stepId, attemptId,
            sequence: predecessor.sequence + 1, runVersion: nextVersion, lastCommittedStepId: run.lastCommittedStepId ?? null,
            predecessorCheckpointId: predecessor.id, predecessorPayloadHash: predecessor.payloadHash,
            invocationFingerprint, resolvedTargetFingerprint: fingerprint(call.target),
          };
          const changedRun = await trx("o_agentRun").where({
            id: runId, status: "queued", version: run.version,
            leaseOwnerId: lease.ownerId, leaseEpoch: lease.epoch, fence: lease.fence,
          }).where("leaseExpiresAt", ">", now).update({
            status: "running", allowedActions: JSON.stringify(["inspect", "cancel"]), startedAt: now, updatedAt: now, version: nextVersion,
          });
          if (changedRun !== 1) return false;
          const changedStep = await trx("o_agentRunStep").where({ id: stepId, status: "pending" }).update({
            status: "running", resolvedTarget: JSON.stringify(call.target), startedAt: now,
          });
          const changedAttempt = await trx("o_agentRunAttempt").where({ id: attemptId, status: "preparing" }).update({
            status: "running", resolvedTarget: JSON.stringify(call.target), invocationFingerprint, startedAt: now,
          });
          if (changedStep !== 1 || changedAttempt !== 1) throw new Error("Agent Run intent 提交发生并发冲突");
          await trx("o_agentRunCheckpoint").insert({
            id: checkpointId, runId, stepId, attemptId, sequence: payload.sequence, kind: payload.kind,
            schemaVersion: payload.schemaVersion, runVersion: nextVersion, lastCommittedStepId: null,
            predecessorCheckpointId: predecessor.id, payload: canonicalCheckpointPayload(payload),
            payloadHash: hashCheckpointPayload(payload), createdAt: now,
          });
          await appendCausalTrace(trx, { id: dependencies.createId(), runId, stepId, attemptId,
            eventType: "run.started", runStatus: "running", stepStatus: "running", createdAt: now });
          return true;
        }));
      } catch (error) {
        throw new ClassifiedAgentRunError({ failureClass: "Artifact", stage: "artifact-persistence", kind: "persistenceFailed",
          severity: "error", certainty: "known-no-effect", expectedness: "unexpected", retryDisposition: "safe-retry" }, error);
      }
      if (!intentCommitted) return;
      await renewal;
      if (heartbeatFailed) throw new AgentRunLeaseLostError();
      await dependencies.work((db) => db.transaction((trx) => assertAgentRunLease(trx, lease, dependencies.now())));
      const toolProjectId = prepared.projectId;
      const toolLease = lease;
      async function invokeReadTool(toolName: ControlledToolName, input: unknown, operationId: string): Promise<unknown> {
        try {
          const revision = dependencies.skillMode
            ? HARNESS_TOOL_DEFINITIONS[toolName].revision
            : TOOL_DEFINITIONS[toolName as keyof typeof TOOL_DEFINITIONS]?.revision;
          if (!revision) return { status: "unavailable", kind: "contractRejected" };
          const result = await controlledTools.execute({
            runId, projectId: toolProjectId, stepId, attemptId, operationId, toolName,
            revision, input, lease: toolLease,
            ...(preparedSkillId ? { skillId: preparedSkillId } : {}),
          });
          return result.status === "recorded" && result.receipt.status === "succeeded"
            ? result.receipt.output
            : { status: "unavailable", kind: result.status === "recorded" ? result.receipt.diagnostic?.kind : result.diagnostic.kind };
        } catch {
          return { status: "unavailable", kind: "executionFailed" };
        }
      }
      async function proposeScriptWrite(kind: "workspace" | "script", payload: unknown,
        operationId: string): Promise<unknown> {
        if (!dependencies.proposeScriptWrite || !preparedSkillId) {
          return { status: "unavailable", kind: "authorizationFailed" };
        }
        try {
          return await dependencies.proposeScriptWrite({ projectId: toolProjectId,
            parentRunId: runId, skillId: preparedSkillId,
            lease: toolLease, operationId, kind, payload });
        } catch {
          return { status: "unavailable", kind: "executionFailed" };
        }
      }
      const result = await call.invokeText({
        messages: invocation.messages,
        tools: {
          get_novel_text: tool({
            description: "读取当前项目中指定章节的原文；输入为章节记录 ID。",
            inputSchema: modelToolDefinitions.get_novel_text.inputSchema,
            execute: async ({ novelId }, options) => invokeReadTool("get_novel_text", { novelId }, options.toolCallId),
          }),
          get_novel_events: tool({
            description: "读取当前项目中指定章节关联的事件；输入为章节记录 ID。",
            inputSchema: modelToolDefinitions.get_novel_events.inputSchema,
            execute: async ({ novelId }, options) => invokeReadTool("get_novel_events", { novelId }, options.toolCallId),
          }),
          ...(dependencies.skillMode ? { get_script_workspace: tool({
            description: "读取当前项目的故事骨架或改编策略工作区文本。",
            inputSchema: HARNESS_TOOL_DEFINITIONS.get_script_workspace.inputSchema,
            execute: async ({ key }, options) => invokeReadTool("get_script_workspace", { key }, options.toolCallId),
          }) } : {}),
          ...(dependencies.skillMode ? { get_script_content: tool({
            description: "读取当前项目中指定剧本的内容；输入为剧本记录 ID。",
            inputSchema: HARNESS_TOOL_DEFINITIONS.get_script_content.inputSchema,
            execute: async ({ scriptId }, options) => invokeReadTool("get_script_content", { scriptId }, options.toolCallId),
          }) } : {}),
          ...(dependencies.proposeScriptWrite ? { propose_script_workspace_write: tool({
            description: "仅提出当前项目单个规划字段的待审批候选；不会写入，Owner 查看全文并批准后才可能生效。",
            inputSchema: SCRIPT_PROPOSAL_TOOL_DEFINITIONS.propose_script_workspace_write.inputSchema,
            execute: async (payload, options) => proposeScriptWrite("workspace", payload, options.toolCallId),
          }), propose_script_content_write: tool({
            description: "仅提出当前项目单个剧本创建或更新候选；不会写入，Owner 查看全文并批准后才可能生效。",
            inputSchema: SCRIPT_PROPOSAL_TOOL_DEFINITIONS.propose_script_content_write.inputSchema,
            execute: async (payload, options) => proposeScriptWrite("script", payload, options.toolCallId),
          }) } : {}),
        },
      });
      const content = result.text;
      const persistableOutput = inspectPersistableText(content);
      if (!persistableOutput.ok) {
        throw new ClassifiedAgentRunError({
          failureClass: "Artifact", stage: "artifact-persistence", kind: "redactionFailed", severity: "error",
          certainty: "known-effect", expectedness: "unexpected", retryDisposition: "never",
        }, new AgentRunContentRejectedError(persistableOutput.violations.map((entry) => entry.code)));
      }
      const now = dependencies.now();
      try {
        await dependencies.work((db) => db.transaction(async (trx) => {
          await assertAgentRunLease(trx, lease, now);
          const run = await trx("o_agentRun").where({ id: runId, status: "running" }).first();
          if (!run) return;
          const step = await trx("o_agentRunStep").where({ id: stepId, status: "running" }).first();
          if (!step) throw new Error("Agent Step 终态提交前态无效");
          const attempt = await trx("o_agentRunAttempt").where({ id: attemptId, status: "running" }).first();
          if (!attempt) throw new Error("Agent Attempt 终态提交前态无效");
          const predecessor = await trx("o_agentRunCheckpoint").where({ runId }).orderBy("sequence", "desc").first();
          if (!predecessor || predecessor.kind !== "model-call-intent") throw new Error("Agent Run 缺少 intent checkpoint");
          assertAgentRunTransition(parseAgentRunStatus(run.status), "succeeded");
          assertAgentRunStepTransition(parseAgentRunStepStatus(step.status), "succeeded");
          const outputId = dependencies.createId();
          const outputContentHash = fingerprint(content);
          const nextVersion = run.version + 1;
          const checkpointId = dependencies.createId();
          const payload: AgentRunCheckpointPayload = {
            schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, kind: "step-committed", runId, stepId, attemptId,
            sequence: predecessor.sequence + 1, runVersion: nextVersion, lastCommittedStepId: stepId,
            predecessorCheckpointId: predecessor.id, predecessorPayloadHash: predecessor.payloadHash,
            outputId, outputContentHash,
          };
          await trx("o_agentRunOutput").insert({
            id: outputId, runId, stepId, kind: "assistant-text", content,
            contentHash: outputContentHash, schemaVersion: AGENT_RUN_OUTPUT_SCHEMA_VERSION, createdAt: now,
          });
          const changedStep = await trx("o_agentRunStep").where({ id: stepId, status: "running" }).update({
            status: "succeeded", completedAt: now,
          });
          const changedAttempt = await trx("o_agentRunAttempt").where({ id: attemptId, status: "running" }).update({ status: "succeeded", completedAt: now });
          const changedRun = await trx("o_agentRun").where({
            id: runId, status: "running", version: run.version,
            leaseOwnerId: lease.ownerId, leaseEpoch: lease.epoch, fence: lease.fence,
          }).where("leaseExpiresAt", ">", now).update({
            status: "succeeded", allowedActions: JSON.stringify(["inspect"]), completedAt: now,
            lastCommittedStepId: stepId, updatedAt: now, version: nextVersion,
            leaseOwnerId: null, leaseEpoch: null, leaseExpiresAt: null,
          });
          if (changedStep !== 1 || changedAttempt !== 1 || changedRun !== 1) throw new Error("Agent Run 终态提交发生并发冲突");
          await trx("o_agentRunCheckpoint").insert({
            id: checkpointId, runId, stepId, attemptId, sequence: payload.sequence, kind: payload.kind,
            schemaVersion: payload.schemaVersion, runVersion: nextVersion, lastCommittedStepId: stepId,
            predecessorCheckpointId: predecessor.id, payload: canonicalCheckpointPayload(payload),
            payloadHash: hashCheckpointPayload(payload), createdAt: now,
          });
          await appendCausalTrace(trx, {
            id: dependencies.createId(), runId, stepId, attemptId, eventType: "run.succeeded",
            runStatus: "succeeded", stepStatus: "succeeded", createdAt: now,
          });
        }));
      } catch (error) {
        throw new ClassifiedAgentRunError({
          failureClass: "Artifact", stage: "artifact-persistence", kind: "persistenceFailed", severity: "error",
          certainty: "known-effect", expectedness: "unexpected", retryDisposition: "reconcile-first",
        }, error);
      }
    } catch (error) {
      if (error instanceof AgentRunLeaseLostError) throw error;
      await settleFailure(runId, stepId, attemptId, lease, intentCommitted, error);
    } finally {
      clearInterval(heartbeat);
      await renewal;
    }
  }

  async function start(input: StartAgentRunInput): Promise<AgentRunSnapshot> {
    if (input.schemaVersion !== AGENT_RUN_START_SCHEMA_VERSION || input.role !== READ_ONLY_AGENT_ROLE
      || ![READ_ONLY_AGENT_SCOPE, SCRIPT_HARNESS_SCOPE].includes(input.scope)) {
      throw new TypeError("不支持的 Agent Run 契约");
    }
    if ((input.scope === SCRIPT_HARNESS_SCOPE) !== Boolean(dependencies.skillMode)) {
      throw new TypeError("Script Harness scope requires guarded Skill mode");
    }
    if (dependencies.skillMode && (!Number.isSafeInteger(input.actorUserId)
      || input.actorUserId! <= 0)) {
      throw new TypeError("Script Harness requires an authenticated Project actor");
    }
    const clientRequestId = input.clientRequestId.trim();
    const content = input.content.trim();
    if (!Number.isInteger(input.projectId) || input.projectId <= 0 || !clientRequestId || !content) {
      throw new TypeError("Agent Run 输入无效");
    }
    const persistableInput = inspectPersistableText(content);
    if (!persistableInput.ok) {
      throw new AgentRunContentRejectedError(persistableInput.violations.map((entry) => entry.code));
    }
    const requestFingerprint = fingerprint({
      schemaVersion: input.schemaVersion, projectId: input.projectId, role: input.role,
      scope: input.scope, clientRequestId, content,
      ...(dependencies.skillMode ? { actorUserId: input.actorUserId } : {}),
    });
    const runId = dependencies.createId();
    const stepId = dependencies.createId();
    const attemptId = dependencies.createId();
    const checkpointId = dependencies.createId();
    const traceId = dependencies.createId();
    const now = dependencies.now();
    const persistStart = () => dependencies.work((db) => db.transaction(async (trx) => {
      await trx("o_agentRun").insert({
        id: runId, projectId: input.projectId, scriptId: null, role: input.role, scope: input.scope,
        clientRequestId, requestFingerprint,
        input: JSON.stringify({ content,
          ...(dependencies.skillMode ? { actorUserId: input.actorUserId } : {}) }),
        status: "queued", waitingReason: null, attentionReason: null,
        allowedActions: JSON.stringify(["inspect", "cancel"]), lastCommittedStepId: null,
        version: 1, createdAt: now, updatedAt: now,
      }).onConflict(["projectId", "role", "scope", "clientRequestId"]).ignore();
      const authoritative = await trx("o_agentRun").where({
        projectId: input.projectId, role: input.role, scope: input.scope, clientRequestId,
      }).first();
      if (!authoritative) throw new Error("Agent Run 幂等写入后无法读取");
      if (authoritative.id !== runId) {
        if (authoritative.requestFingerprint !== requestFingerprint) throw new AgentRunConflictError();
        return { snapshot: await readSnapshot(trx, authoritative.id, input.projectId), created: false, stepId: "" };
      }
      const project = await trx("o_project").where("id", input.projectId).first("id");
      if (!project) throw new AgentRunProjectNotFoundError(input.projectId);
      await trx("o_agentRunStep").insert({
        id: stepId, runId, ordinal: 1, kind: "model", logicalTarget: JSON.stringify(LOGICAL_TARGET),
        resolvedTarget: null, promptFingerprint: fingerprint({
          version: dependencies.proposeScriptWrite ? SCRIPT_PROPOSAL_PROMPT_VERSION : PROMPT_VERSION,
          prompt: dependencies.proposeScriptWrite ? SCRIPT_PROPOSAL_SYSTEM_PROMPT : SYSTEM_PROMPT,
        }), status: "pending",
      });
      await trx("o_agentRunAttempt").insert({
        id: attemptId, runId, stepId, ordinal: 1, predecessorAttemptId: null, reason: "initial",
        status: "preparing", resolvedTarget: null, invocationFingerprint: null, createdAt: now,
      });
      const checkpointPayload: AgentRunCheckpointPayload = {
        schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, kind: "run-created", runId, stepId, attemptId,
        sequence: 1, runVersion: 1, lastCommittedStepId: null, predecessorCheckpointId: null,
        predecessorPayloadHash: null, requestFingerprint,
      };
      await trx("o_agentRunCheckpoint").insert({
        id: checkpointId, runId, stepId, attemptId, sequence: 1, kind: checkpointPayload.kind,
        schemaVersion: checkpointPayload.schemaVersion, runVersion: 1, lastCommittedStepId: null,
        predecessorCheckpointId: null, payload: canonicalCheckpointPayload(checkpointPayload),
        payloadHash: hashCheckpointPayload(checkpointPayload), createdAt: now,
      });
      await appendCausalTrace(trx, {
        id: traceId, runId, stepId, attemptId, eventType: "run.created",
        runStatus: "queued", stepStatus: "pending", createdAt: now,
      });
      await dependencies.prepareRun?.(trx, { runId, projectId: input.projectId,
        role: input.role, content, createdAt: now, actorUserId: input.actorUserId });
      return { snapshot: await readSnapshot(trx, runId, input.projectId), created: true, stepId, attemptId };
    }));
    let created: { snapshot: AgentRunSnapshot | null; created: boolean; stepId: string; attemptId?: string } | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        created = await persistStart();
        break;
      } catch (error) {
        if ((error as { code?: unknown })?.code !== "SQLITE_BUSY" || attempt === 1) throw error;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    if (!created) throw new Error("Agent Run 幂等写入未完成");
    if (!created.snapshot) throw new Error("Agent Run 创建后无法读取");
    if (created.created && created.attemptId) dependencies.schedule(() => execute(created.snapshot!.id, created.stepId, created.attemptId!));
    return created.snapshot;
  }

  return { start, inspect, cancel, list };
}

export function projectAgentRunToChatMessage(snapshot: AgentRunSnapshot): AIMessage {
  const displayStatus = snapshot.attentionReason ? "needs-attention" : snapshot.status;
  const content = snapshot.status === "succeeded" && !snapshot.attentionReason
    ? snapshot.outputs.map((output) => ({ type: "markdown" as const, id: `${snapshot.id}:output`, status: "complete" as const, data: output.content }))
    : [{
        type: "markdown" as const,
        id: `${snapshot.id}:status`,
        status: snapshot.status === "failed" && !snapshot.attentionReason ? "error" as const : "pending" as const,
        data: snapshot.status === "failed" && !snapshot.attentionReason ? "Agent 执行失败" : `Agent Run：${displayStatus}`,
      }];
  const messageStatus = snapshot.attentionReason ? "pending"
    : snapshot.status === "succeeded" ? "complete"
    : snapshot.status === "failed" ? "error"
      : snapshot.status === "cancelled" ? "stop"
        : snapshot.status === "running" ? "streaming" : "pending";
  return {
    id: snapshot.id,
    role: "assistant",
    status: messageStatus,
    datetime: new Date(snapshot.createdAt).toISOString(),
    content,
    ext: {
      agentRun: {
        schemaVersion: "toonflow.agent-run-ui.v1",
        runId: snapshot.id,
        version: snapshot.version,
        status: snapshot.status,
        displayStatus,
        attentionReason: snapshot.attentionReason,
        allowedActions: snapshot.allowedActions,
      },
    },
  };
}

let defaultRuntime: AgentRuntime | undefined;

export function getDefaultAgentRuntime(): AgentRuntime {
  if (!defaultRuntime) {
    defaultRuntime = createAgentRuntime({
      work: (operation) => getDatabaseRuntime().work(operation),
      openTextCall: (target) => getDefaultConfiguredVendor().openTextCall(target),
      schedule: (work) => {
        setImmediate(() => void work().catch(() => console.error("[agentRun] scheduled execution failed")));
      },
      now: () => Date.now(),
      createId: () => uuid(),
    });
  }
  return defaultRuntime;
}
