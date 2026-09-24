import { createHash } from "node:crypto";

import type { Knex } from "knex";
import { v4 as uuid } from "uuid";

import type { AgentRunLease } from "@/agentRuntime/lease";
import { AgentRunLeaseLostError, assertAgentRunLease } from "@/agentRuntime/lease";
import { appendCausalTrace } from "@/agentRuntime/causalTrace";
import type { DatabaseWork } from "@/database";
import { getDatabaseRuntime } from "@/database";
import { authorizeBoundSkillTool } from "@/skillRuntime/permissions";
import {
  inspectPersistableText,
  projectTraceSafeDiagnostic,
  validateTraceSafeDiagnostic,
  type TraceSafeDiagnostic,
} from "@/diagnostics/traceSafeDiagnostics";

import { TOOL_DEFINITIONS, HARNESS_TOOL_DEFINITIONS, getControlledToolDefinition, toolDefinitionContractHash,
  type ControlledToolName } from "./definitions";

export { TOOL_DEFINITIONS, HARNESS_TOOL_DEFINITIONS, SCRIPT_PROPOSAL_TOOL_DEFINITIONS, getControlledToolDefinition,
  toolDefinitionContractHash } from "./definitions";
export type { ControlledToolName } from "./definitions";

export interface ExecuteControlledToolInput {
  runId: string;
  projectId: number;
  operationId: string;
  toolName: ControlledToolName;
  revision: string;
  input: unknown;
  lease: AgentRunLease;
  skillId?: string;
}

export interface ToolReceiptSnapshot {
  id: string;
  runId: string;
  operationId: string;
  toolName: ControlledToolName;
  toolRevision: string;
  inputHash: string;
  status: "pending" | "succeeded" | "failed";
  outputHash?: string;
  output?: unknown;
  diagnostic?: TraceSafeDiagnostic;
  createdAt: number;
  updatedAt: number;
}

export type ControlledToolResult =
  | { status: "rejected"; diagnostic: TraceSafeDiagnostic }
  | { status: "recorded"; receipt: ToolReceiptSnapshot };

export interface ToolAdapterContext {
  readonly runId: string;
  readonly projectId: number;
}

export type ToolAdapter = (context: Readonly<ToolAdapterContext>, input: unknown) => Promise<unknown>;

export interface ControlledToolDependencies {
  work: DatabaseWork;
  now(): number;
  createId(): string;
  adapters?: Partial<Record<ControlledToolName, ToolAdapter>>;
  skillGrants?: (tx: Knex.Transaction, input: { runId: string; projectId: number;
    toolName: ControlledToolName }) => Promise<{ platformGrants: readonly string[];
    projectGrants: readonly string[]; runGrants: readonly string[];
    roleGrants: readonly string[] }>;
}

export class ToolOperationConflictError extends Error {
  constructor() {
    super("Tool operation identity was reused for a different call");
    this.name = "ToolOperationConflictError";
  }
}

export class ToolEvidenceCorruptError extends Error {
  constructor() {
    super("ToolReceipt evidence is invalid");
    this.name = "ToolEvidenceCorruptError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeDiagnostic(kind: "contractRejected" | "authorizationFailed" | "executionFailed" | "invalidOutput" | "timeout", audience: "toolReceipt" | "trace"): TraceSafeDiagnostic {
  const projected = projectTraceSafeDiagnostic({
    failureClass: "Tool", stage: "tool-call", kind, severity: "error",
    certainty: "known-no-effect", expectedness: kind === "authorizationFailed" ? "expected" : "unexpected",
    retryDisposition: kind === "executionFailed" || kind === "timeout" ? "safe-retry" : "never",
  }, audience);
  if (!projected.ok) throw new Error("Tool diagnostic projection failed");
  return projected.value;
}

async function insertTrace(
  trx: Knex.Transaction,
  input: { runId: string; receiptId: string; eventType: string; now: number; createId(): string; diagnosticKind?: "authorizationFailed" | "executionFailed" | "invalidOutput" | "timeout" },
): Promise<void> {
  const diagnostic = input.diagnosticKind ? safeDiagnostic(input.diagnosticKind, "trace") : undefined;
  await appendCausalTrace(trx, {
    id: input.createId(), runId: input.runId, toolReceiptId: input.receiptId,
    eventType: input.eventType, diagnostic, createdAt: input.now,
  });
}

function readReceipt(row: any): ToolReceiptSnapshot {
  const definition = getControlledToolDefinition(row.toolName as ControlledToolName, row.toolRevision);
  if (!definition || !["pending", "succeeded", "failed"].includes(row.status)) {
    throw new ToolEvidenceCorruptError();
  }
  let output: unknown;
  if (row.status === "succeeded") {
    if (typeof row.outputJson !== "string" || sha256(row.outputJson) !== row.outputHash) throw new ToolEvidenceCorruptError();
    try { output = JSON.parse(row.outputJson); } catch { throw new ToolEvidenceCorruptError(); }
    if (!definition.outputSchema.safeParse(output).success || !inspectPersistableText(row.outputJson).ok) throw new ToolEvidenceCorruptError();
  } else if (row.outputJson != null || row.outputHash != null) {
    throw new ToolEvidenceCorruptError();
  }
  let diagnostic: TraceSafeDiagnostic | undefined;
  if (row.diagnostic != null) {
    let parsed: unknown;
    try { parsed = JSON.parse(row.diagnostic); } catch { throw new ToolEvidenceCorruptError(); }
    const checked = validateTraceSafeDiagnostic(parsed, "toolReceipt");
    if (!checked.ok) throw new ToolEvidenceCorruptError();
    diagnostic = checked.value;
  }
  if ((row.status === "failed") !== Boolean(diagnostic)) throw new ToolEvidenceCorruptError();
  return {
    id: row.id, runId: row.runId, operationId: row.operationId,
    toolName: row.toolName, toolRevision: row.toolRevision, inputHash: row.inputHash,
    status: row.status, ...(row.outputHash ? { outputHash: row.outputHash, output } : {}),
    ...(diagnostic ? { diagnostic } : {}), createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function defaultAdapters(work: DatabaseWork): Record<ControlledToolName, ToolAdapter> {
  return {
    get_novel_text: async (context, input) => work(async (db) => {
      const { novelId } = TOOL_DEFINITIONS.get_novel_text.inputSchema.parse(input);
      const row = await db("o_novel").where({ id: novelId, projectId: context.projectId })
        .first("id", "chapterIndex", "chapter", "chapterData");
      if (!row) throw new Error("Authorized novel disappeared");
      return { novelId: row.id, chapterIndex: row.chapterIndex, chapter: row.chapter ?? "", text: row.chapterData ?? "" };
    }),
    get_novel_events: async (context, input) => work(async (db) => {
      const { novelId } = TOOL_DEFINITIONS.get_novel_events.inputSchema.parse(input);
      const rows = await db("o_eventChapter as ec")
        .join("o_event as e", "e.id", "ec.eventId")
        .join("o_novel as n", "n.id", "ec.novelId")
        .where({ "n.id": novelId, "n.projectId": context.projectId })
        .distinct("e.id", "e.name", "e.detail")
        .orderBy("e.id", "asc").limit(21);
      return { novelId, truncated: rows.length > 20,
        events: rows.slice(0, 20).map((row) => ({ id: row.id, name: row.name ?? "", detail: row.detail ?? "" })) };
    }),
    get_script_workspace: async (context, input) => work(async (db) => {
      const { key } = HARNESS_TOOL_DEFINITIONS.get_script_workspace.inputSchema.parse(input);
      const row = await db("o_agentWorkData")
        .where({ projectId: context.projectId, key: "scriptAgent" }).first("data");
      const data: unknown = row ? JSON.parse(row.data ?? "{}") : {};
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Script workspace data is invalid");
      }
      const content = (data as Record<string, unknown>)[key] ?? "";
      if (typeof content !== "string") throw new Error("Script workspace field is invalid");
      return { key, content };
    }),
    get_script_content: async (context, input) => work(async (db) => {
      const { scriptId } = HARNESS_TOOL_DEFINITIONS.get_script_content.inputSchema.parse(input);
      const row = await db("o_script").where({ id: scriptId,
        projectId: context.projectId }).first("id", "name", "content");
      if (!row) throw new Error("Authorized script disappeared");
      return { scriptId: row.id, name: row.name ?? "", content: row.content ?? "" };
    }),
  };
}

/** The model-facing seam has one operation and never exposes database or transport handles. */
export function createControlledToolRuntime(dependencies: ControlledToolDependencies) {
  const adapters = { ...defaultAdapters(dependencies.work), ...dependencies.adapters };
  return {
    async execute(request: ExecuteControlledToolInput): Promise<ControlledToolResult> {
      const definition = getControlledToolDefinition(request.toolName, request.revision);
      const parsed = definition?.inputSchema.safeParse(request.input);
      if (!definition || request.revision !== definition.revision || !parsed?.success
        || (HARNESS_TOOL_DEFINITIONS[request.toolName]?.revision === request.revision
          && !dependencies.skillGrants)
        || !request.runId || !Number.isSafeInteger(request.projectId) || request.projectId <= 0
        || !/^[A-Za-z0-9._:-]{1,128}$/u.test(request.operationId)) {
        return { status: "rejected", diagnostic: safeDiagnostic("contractRejected", "toolReceipt") };
      }
      const normalized = parsed.data;
      const inputHash = sha256(JSON.stringify({ toolName: definition.name, revision: definition.revision, input: normalized }));
      const now = dependencies.now();
      const prepared = await dependencies.work((db) => db.transaction(async (trx) => {
        const run = await trx("o_agentRun").where({
          id: request.runId, projectId: request.projectId, status: "running",
        }).whereNull("cancellationRequestedAt")
          .whereIn("role", definition.policy.roles).whereIn("scope", definition.policy.scopes)
          .first("id", "projectId");
        if (!run || request.lease.runId !== request.runId) return { kind: "rejected" as const };
        await assertAgentRunLease(trx, request.lease, now);
        if (dependencies.skillGrants) {
          if (!request.skillId) return { kind: "rejected" as const };
          const grants = await dependencies.skillGrants(trx, { runId: run.id,
            projectId: run.projectId, toolName: request.toolName });
          try {
            const authority = await authorizeBoundSkillTool(trx, { runId: run.id,
              projectId: run.projectId, skillId: request.skillId,
              toolName: request.toolName, toolRevision: request.revision, ...grants });
            const decisionJson = JSON.stringify(authority.decision);
            const previous = await trx("o_agentSkillPermissionDecision")
              .where({ runId: run.id, operationId: request.operationId }).first();
            if (previous) {
              if (previous.skillId !== request.skillId || previous.toolName !== request.toolName
                || previous.skillRevisionId !== authority.skillRevisionId) {
                throw new ToolOperationConflictError();
              }
              if (sha256(previous.decisionJson) !== previous.decisionHash) {
                throw new ToolEvidenceCorruptError();
              }
              const recorded = JSON.parse(previous.decisionJson) as { allowed?: unknown };
              if (recorded.allowed !== true || !authority.decision.allowed) {
                return { kind: "rejected" as const };
              }
            } else {
              await trx("o_agentSkillPermissionDecision").insert({
                id: dependencies.createId(), runId: run.id, skillId: request.skillId,
                skillRevisionId: authority.skillRevisionId, operationId: request.operationId,
                toolName: request.toolName, decisionJson, decisionHash: sha256(decisionJson),
                createdAt: now,
              });
              if (!authority.decision.allowed) return { kind: "rejected" as const };
            }
          } catch (error) {
            if (error instanceof Error && (error.message.includes("outside authorized Run binding")
              || error.message.includes("was revoked"))) return { kind: "rejected" as const };
            throw error;
          }
        }
        const contractHash = toolDefinitionContractHash(definition);
        const catalog = await trx("o_agentToolDefinition").where({ name: definition.name, revision: definition.revision }).first();
        if (catalog && catalog.contractHash !== contractHash) throw new ToolEvidenceCorruptError();
        if (!catalog) await trx("o_agentToolDefinition").insert({
          id: dependencies.createId(), name: definition.name, revision: definition.revision,
          contractHash, policy: JSON.stringify(definition.policy), createdAt: now,
        });
        const existing = await trx("o_agentToolReceipt").where({ runId: run.id, operationId: request.operationId }).first();
        if (existing) {
          if (existing.toolName !== definition.name || existing.toolRevision !== definition.revision || existing.inputHash !== inputHash) {
            throw new ToolOperationConflictError();
          }
          return { kind: "existing" as const, receipt: readReceipt(existing) };
        }
        const authorizedResource = "novelId" in normalized
          ? await trx("o_novel").where({ id: normalized.novelId,
            projectId: run.projectId }).first("id")
          : "scriptId" in normalized
            ? await trx("o_script").where({ id: normalized.scriptId,
              projectId: run.projectId }).first("id")
            : await trx("o_project").where({ id: run.projectId }).first("id");
        const receiptId = dependencies.createId();
        const status = authorizedResource ? "pending" : "failed";
        const diagnostic = authorizedResource ? undefined : safeDiagnostic("authorizationFailed", "toolReceipt");
        await trx("o_agentToolReceipt").insert({
          id: receiptId, runId: run.id, operationId: request.operationId,
          toolName: definition.name, toolRevision: definition.revision, inputHash,
          status, diagnostic: diagnostic ? JSON.stringify(diagnostic) : null,
          createdAt: now, updatedAt: now,
        });
        await insertTrace(trx, {
          runId: run.id, receiptId, eventType: authorizedResource ? "tool.started" : "tool.denied",
          now, createId: dependencies.createId,
          ...(!authorizedResource ? { diagnosticKind: "authorizationFailed" as const } : {}),
        });
        return { kind: authorizedResource ? "execute" as const : "existing" as const,
          receipt: readReceipt(await trx("o_agentToolReceipt").where("id", receiptId).first()) };
      })).catch((error: unknown) => {
        if (error instanceof AgentRunLeaseLostError) return { kind: "rejected" as const };
        throw error;
      });
      if (prepared.kind === "rejected") return { status: "rejected", diagnostic: safeDiagnostic("authorizationFailed", "toolReceipt") };
      if (prepared.kind === "existing") return { status: "recorded", receipt: prepared.receipt };

      let output: unknown;
      let failure: "executionFailed" | "invalidOutput" | "timeout" | undefined;
      const context = Object.freeze({ runId: request.runId, projectId: request.projectId });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        output = await Promise.race([
          adapters[request.toolName](context, normalized),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("controlled-tool-timeout")), definition.policy.timeoutMs);
          }),
        ]);
        const checked = definition.outputSchema.safeParse(output);
        if (!checked.success || !inspectPersistableText(JSON.stringify(output)).ok) failure = "invalidOutput";
        else output = checked.data;
      } catch (error) {
        failure = error instanceof Error && error.message === "controlled-tool-timeout" ? "timeout" : "executionFailed";
      } finally {
        if (timer) clearTimeout(timer);
      }

      const completedAt = dependencies.now();
      const receipt = await dependencies.work((db) => db.transaction(async (trx) => {
        await assertAgentRunLease(trx, request.lease, completedAt);
        const current = await trx("o_agentToolReceipt").where({ id: prepared.receipt.id, status: "pending" }).first();
        if (!current) throw new ToolEvidenceCorruptError();
        const outputJson = failure ? null : JSON.stringify(output);
        const diagnostic = failure ? safeDiagnostic(failure, "toolReceipt") : undefined;
        const changed = await trx("o_agentToolReceipt").where({ id: current.id, status: "pending" }).update({
          status: failure ? "failed" : "succeeded", outputJson,
          outputHash: outputJson ? sha256(outputJson) : null,
          diagnostic: diagnostic ? JSON.stringify(diagnostic) : null, updatedAt: completedAt,
        });
        if (changed !== 1) throw new ToolEvidenceCorruptError();
        await insertTrace(trx, {
          runId: request.runId, receiptId: current.id,
          eventType: failure ? "tool.failed" : "tool.succeeded", now: completedAt,
          createId: dependencies.createId, ...(failure ? { diagnosticKind: failure } : {}),
        });
        return readReceipt(await trx("o_agentToolReceipt").where("id", current.id).first());
      }));
      return { status: "recorded", receipt };
    },
  };
}

export function getDefaultControlledToolRuntime() {
  return createControlledToolRuntime({
    work: (operation) => getDatabaseRuntime().work(operation),
    now: Date.now,
    createId: uuid,
  });
}
