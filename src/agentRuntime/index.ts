import { createHash } from "node:crypto";

import type { Knex } from "knex";
import { v4 as uuid } from "uuid";

import type { DatabaseWork } from "@/database";
import {
  inspectPersistableText,
  projectTraceSafeDiagnostic,
  TRACE_SAFE_DIAGNOSTIC_SCHEMA_VERSION,
  type TraceSafeDiagnostic,
  type TraceSafeDiagnosticInput,
  validateTraceSafeDiagnostic,
} from "@/diagnostics/traceSafeDiagnostics";
import type { AIMessage } from "@/socket/chatMessagesData";
import { getDefaultConfiguredVendor, type ConfiguredTextCall, type TextModelTarget } from "@/vendor";
import { getDatabaseRuntime } from "@/database";

import {
  assertAgentRunStepTransition,
  assertAgentRunTransition,
  parseAgentRunStatus,
  parseAgentRunStepStatus,
  type AgentRunStatus,
  type AgentRunStepStatus,
} from "./lifecycle";

export * from "./lifecycle";

export const AGENT_RUN_START_SCHEMA_VERSION = "toonflow.agent-run.start.v1" as const;
export const AGENT_RUN_OUTPUT_SCHEMA_VERSION = "toonflow.agent-run-output.v1" as const;
export const READ_ONLY_AGENT_ROLE = "scriptAgent" as const;
export const READ_ONLY_AGENT_SCOPE = "read-only-project-guidance-v1" as const;
const LOGICAL_TARGET: TextModelTarget = { kind: "logical", key: "scriptAgent:decisionAgent" };
const PROMPT_VERSION = "toonflow.read-only-project-guidance.v1";
const SYSTEM_PROMPT = [
  "你是 Toonflow 的只读项目顾问。",
  "只能依据给出的项目事实回答用户，不得声称已修改项目，不得请求或调用工具。",
  "当事实不足时明确说明缺少信息。",
].join("\n");

export interface StartAgentRunInput {
  schemaVersion: typeof AGENT_RUN_START_SCHEMA_VERSION;
  projectId: number;
  role: typeof READ_ONLY_AGENT_ROLE;
  scope: typeof READ_ONLY_AGENT_SCOPE;
  clientRequestId: string;
  content: string;
}

export interface InspectAgentRunInput {
  runId: string;
  projectId: number;
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
  sequence: number;
  eventType: string;
  runStatus?: AgentRunStatus;
  stepStatus?: AgentRunStepStatus;
  diagnostic?: TraceSafeDiagnostic;
  createdAt: number;
}

export interface AgentRunSnapshot {
  id: string;
  projectId: number;
  role: typeof READ_ONLY_AGENT_ROLE;
  scope: typeof READ_ONLY_AGENT_SCOPE;
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
  steps: AgentRunStepSnapshot[];
  outputs: AgentRunOutputSnapshot[];
  traces: AgentTraceSnapshot[];
}

export interface AgentRuntime {
  start(input: StartAgentRunInput): Promise<AgentRunSnapshot>;
  inspect(input: InspectAgentRunInput): Promise<AgentRunSnapshot | null>;
}

export interface AgentRunDependencies {
  work: DatabaseWork;
  openTextCall(target: TextModelTarget): Promise<ConfiguredTextCall>;
  schedule(work: () => Promise<void>): void;
  now(): number;
  createId(): string;
}

export class AgentRunConflictError extends Error {
  constructor() {
    super("clientRequestId 已被不同请求使用");
    this.name = "AgentRunConflictError";
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

async function readSnapshot(db: Knex | Knex.Transaction, runId: string, projectId: number): Promise<AgentRunSnapshot | null> {
  const run = await db("o_agentRun").where({ id: runId, projectId }).first();
  if (!run) return null;
  const [steps, outputs, traces] = await Promise.all([
    db("o_agentRunStep").where("runId", runId).orderBy("ordinal", "asc"),
    db("o_agentRunOutput").where("runId", runId).orderBy("createdAt", "asc"),
    db("o_agentTrace").where("runId", runId).orderBy("sequence", "asc"),
  ]);
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
    outputs: outputs.map((output) => ({
      id: output.id,
      stepId: output.stepId,
      kind: output.kind,
      content: output.content,
      contentHash: output.contentHash,
      schemaVersion: output.schemaVersion,
      createdAt: output.createdAt,
    })),
    traces: traces.map((trace) => ({
      id: trace.id,
      ...(trace.stepId ? { stepId: trace.stepId } : {}),
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
  async function inspect(input: InspectAgentRunInput): Promise<AgentRunSnapshot | null> {
    return dependencies.work((db) => readSnapshot(db, input.runId, input.projectId));
  }

  async function markFailed(runId: string, stepId: string, error: unknown): Promise<void> {
    const diagnostic = projectFailure(error);
    const now = dependencies.now();
    await dependencies.work((db) => db.transaction(async (trx) => {
      const run = await trx("o_agentRun").where("id", runId).first();
      if (!run || !["queued", "running"].includes(run.status)) return;
      const step = await trx("o_agentRunStep").where("id", stepId).first();
      if (!step || !["pending", "running"].includes(step.status)) return;
      const runStatus = parseAgentRunStatus(run.status);
      const stepStatus = parseAgentRunStepStatus(step.status);
      assertAgentRunTransition(runStatus, "failed");
      assertAgentRunStepTransition(stepStatus, "failed");
      const sequenceRow = await trx("o_agentTrace").where("runId", runId).max<{ sequence?: number }>("sequence as sequence").first();
      const sequence = Number(sequenceRow?.sequence ?? 0) + 1;
      const changedStep = await trx("o_agentRunStep").where({ id: stepId, status: stepStatus }).update({ status: "failed", completedAt: now });
      const changedRun = await trx("o_agentRun").where({ id: runId, status: runStatus, version: run.version }).update({
        status: "failed",
        allowedActions: JSON.stringify(["inspect"]),
        failureDiagnostic: JSON.stringify(diagnostic),
        completedAt: now,
        updatedAt: now,
        version: run.version + 1,
      });
      if (changedStep !== 1 || changedRun !== 1) throw new Error("Agent Run 失败状态提交发生并发冲突");
      await trx("o_agentTrace").insert({
        id: dependencies.createId(),
        runId,
        stepId,
        sequence,
        eventType: "run.failed",
        runStatus: "failed",
        stepStatus: "failed",
        diagnosticSchemaVersion: TRACE_SAFE_DIAGNOSTIC_SCHEMA_VERSION,
        diagnostic: JSON.stringify(diagnostic),
        createdAt: now,
      });
    }));
  }

  async function execute(runId: string, stepId: string): Promise<void> {
    const claimed = await dependencies.work((db) => db.transaction(async (trx) => {
      const run = await trx("o_agentRun").where({ id: runId, status: "queued" }).first();
      if (!run) return null;
      const step = await trx("o_agentRunStep").where({ id: stepId, status: "pending" }).first();
      if (!step) return null;
      assertAgentRunTransition(parseAgentRunStatus(run.status), "running");
      assertAgentRunStepTransition(parseAgentRunStepStatus(step.status), "running");
      const now = dependencies.now();
      const changed = await trx("o_agentRun").where({ id: runId, status: "queued", version: run.version }).update({
        status: "running",
        allowedActions: JSON.stringify(["inspect"]),
        startedAt: now,
        updatedAt: now,
        version: run.version + 1,
      });
      if (changed !== 1) return null;
      const changedStep = await trx("o_agentRunStep").where({ id: stepId, status: "pending" }).update({ status: "running", startedAt: now });
      if (changedStep !== 1) throw new Error("Agent Step 领取发生并发冲突");
      await trx("o_agentTrace").insert({
        id: dependencies.createId(), runId, stepId, sequence: 2, eventType: "run.started",
        runStatus: "running", stepStatus: "running", createdAt: now,
      });
      return { input: parseJson<{ content: string }>(run.input, { content: "" }), projectId: run.projectId };
    }));
    if (!claimed) return;

    try {
      let project: {
        name?: string | null;
        type?: string | null;
        intro?: string | null;
        artStyle?: string | null;
        videoRatio?: string | null;
      } | undefined;
      let chapterRow: { count?: number } | undefined;
      try {
        [project, chapterRow] = await Promise.all([
          dependencies.work((db) => db("o_project").where("id", claimed.projectId).first()),
          dependencies.work((db) => db("o_novel").where("projectId", claimed.projectId).count<{ count: number }[]>("id as count").first()),
        ]);
      } catch (error) {
        throw new ClassifiedAgentRunError({
          failureClass: "Context", stage: "context-build", kind: "executionFailed", severity: "error",
          certainty: "known-no-effect", expectedness: "unexpected", retryDisposition: "safe-retry",
        }, error);
      }
      if (!project) {
        throw new ClassifiedAgentRunError({
          failureClass: "Context", stage: "context-build", kind: "contextMissing", severity: "error",
          certainty: "known-no-effect", expectedness: "unexpected", retryDisposition: "never",
        }, new AgentRunProjectNotFoundError(claimed.projectId));
      }
      let call: ConfiguredTextCall;
      try {
        call = await dependencies.openTextCall(LOGICAL_TARGET);
      } catch (error) {
        throw new ClassifiedAgentRunError({
          failureClass: "Vendor", stage: "vendor-request", kind: "executionFailed", severity: "error",
          certainty: "known-no-effect", expectedness: "unexpected", retryDisposition: "safe-retry",
        }, error);
      }
      try {
        await dependencies.work((db) => db("o_agentRunStep").where({ id: stepId, status: "running" }).update({
          resolvedTarget: JSON.stringify(call.target),
        }).then((changed) => {
          if (changed !== 1) throw new Error("Agent Step 模型目标提交发生并发冲突");
        }));
      } catch (error) {
        throw new ClassifiedAgentRunError({
          failureClass: "Artifact", stage: "artifact-persistence", kind: "persistenceFailed", severity: "error",
          certainty: "known-no-effect", expectedness: "unexpected", retryDisposition: "safe-retry",
        }, error);
      }
      const projectFacts = [
        `项目名称：${project.name ?? "未知"}`,
        `项目类型：${project.type ?? "未知"}`,
        `项目简介：${project.intro ?? "无"}`,
        `视觉风格：${project.artStyle ?? "无"}`,
        `视频画幅：${project.videoRatio ?? "16:9"}`,
        `章节数量：${Number(chapterRow?.count ?? 0)}`,
      ].join("\n");
      const result = await call.invokeText({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "assistant", content: projectFacts },
          { role: "user", content: claimed.input.content },
        ],
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
          const run = await trx("o_agentRun").where({ id: runId, status: "running" }).first();
          if (!run) return;
          const step = await trx("o_agentRunStep").where({ id: stepId, status: "running" }).first();
          if (!step) throw new Error("Agent Step 终态提交前态无效");
          assertAgentRunTransition(parseAgentRunStatus(run.status), "succeeded");
          assertAgentRunStepTransition(parseAgentRunStepStatus(step.status), "succeeded");
          await trx("o_agentRunOutput").insert({
            id: dependencies.createId(), runId, stepId, kind: "assistant-text", content,
            contentHash: fingerprint(content), schemaVersion: AGENT_RUN_OUTPUT_SCHEMA_VERSION, createdAt: now,
          });
          const changedStep = await trx("o_agentRunStep").where({ id: stepId, status: "running" }).update({
            status: "succeeded", completedAt: now,
          });
          const changedRun = await trx("o_agentRun").where({ id: runId, status: "running", version: run.version }).update({
            status: "succeeded", allowedActions: JSON.stringify(["inspect"]), completedAt: now,
            updatedAt: now, version: run.version + 1,
          });
          if (changedStep !== 1 || changedRun !== 1) throw new Error("Agent Run 终态提交发生并发冲突");
          await trx("o_agentTrace").insert({
            id: dependencies.createId(), runId, stepId, sequence: 3, eventType: "run.succeeded",
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
      await markFailed(runId, stepId, error);
    }
  }

  async function start(input: StartAgentRunInput): Promise<AgentRunSnapshot> {
    if (input.schemaVersion !== AGENT_RUN_START_SCHEMA_VERSION || input.role !== READ_ONLY_AGENT_ROLE || input.scope !== READ_ONLY_AGENT_SCOPE) {
      throw new TypeError("不支持的 Agent Run 契约");
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
    });
    const runId = dependencies.createId();
    const stepId = dependencies.createId();
    const traceId = dependencies.createId();
    const now = dependencies.now();
    const persistStart = () => dependencies.work((db) => db.transaction(async (trx) => {
      await trx("o_agentRun").insert({
        id: runId, projectId: input.projectId, scriptId: null, role: input.role, scope: input.scope,
        clientRequestId, requestFingerprint, input: JSON.stringify({ content }),
        status: "queued", waitingReason: null, attentionReason: null,
        allowedActions: JSON.stringify(["inspect"]), version: 1, createdAt: now, updatedAt: now,
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
        resolvedTarget: null, promptFingerprint: fingerprint({ version: PROMPT_VERSION, prompt: SYSTEM_PROMPT }), status: "pending",
      });
      await trx("o_agentTrace").insert({
        id: traceId, runId, stepId, sequence: 1, eventType: "run.created",
        runStatus: "queued", stepStatus: "pending", createdAt: now,
      });
      return { snapshot: await readSnapshot(trx, runId, input.projectId), created: true, stepId };
    }));
    let created: { snapshot: AgentRunSnapshot | null; created: boolean; stepId: string } | undefined;
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
    if (created.created) dependencies.schedule(() => execute(created.snapshot!.id, created.stepId));
    return created.snapshot;
  }

  return { start, inspect };
}

export function projectAgentRunToChatMessage(snapshot: AgentRunSnapshot): AIMessage {
  const displayStatus = snapshot.status === "waiting" && snapshot.attentionReason ? "needs-attention" : snapshot.status;
  const content = snapshot.status === "succeeded"
    ? snapshot.outputs.map((output) => ({ type: "markdown" as const, id: `${snapshot.id}:output`, status: "complete" as const, data: output.content }))
    : [{
        type: "markdown" as const,
        id: `${snapshot.id}:status`,
        status: snapshot.status === "failed" ? "error" as const : "pending" as const,
        data: snapshot.status === "failed" ? "Agent 执行失败" : `Agent Run：${displayStatus}`,
      }];
  const messageStatus = snapshot.status === "succeeded" ? "complete"
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
