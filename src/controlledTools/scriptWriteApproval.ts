import { createHash } from "node:crypto";

import type { Knex } from "knex";
import { v4 as uuid } from "uuid";

import {
  AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
  canonicalCheckpointPayload, hashCheckpointPayload,
  type AgentRunCheckpointPayload,
} from "@/agentRuntime";
import { appendCausalTrace } from "@/agentRuntime/causalTrace";
import type { DatabaseWork } from "@/database";
import { getDatabaseRuntime } from "@/database";

import {
  SCRIPT_CONTENT_WRITE_TOOL_DEFINITION,
  SCRIPT_WORKSPACE_WRITE_TOOL_DEFINITION,
  toolDefinitionContractHash,
} from "./definitions";
import {
  freezeScriptWritePayload, scriptContentWriteInput, scriptContentWritePreview,
  scriptWorkspaceWriteInput, scriptWorkspaceWritePreview,
} from "./scriptWriteContract";
import { scriptContentTargetState, scriptWorkspaceTargetState } from "./scriptWriteState";

export const SCRIPT_WRITE_RUN_SCOPE = "approved-script-write-v1" as const;
export const SCRIPT_WRITE_APPROVAL_TTL_MS = 10 * 60_000;

type ScriptWriteKind = "workspace" | "script";
type WriteTool = typeof SCRIPT_WORKSPACE_WRITE_TOOL_DEFINITION
  | typeof SCRIPT_CONTENT_WRITE_TOOL_DEFINITION;

export interface ProposeScriptWriteInput {
  projectId: number;
  actorUserId: number;
  clientRequestId: string;
  operationId: string;
  kind: ScriptWriteKind;
  payload: unknown;
}

export interface ScriptWriteApprovalSnapshot {
  id: string;
  runId: string;
  receiptId: string;
  operationId: string;
  kind: ScriptWriteKind;
  toolRevision: string;
  payloadHash: string;
  targetStateHash: string;
  status: "pending" | "approved" | "rejected" | "expired" | "conflicted" | "corrupt";
  expiresAt: number;
  preview: unknown;
  runVersion: number;
  runStatus: string;
}

export class ScriptWriteProposalRejectedError extends Error {
  constructor(readonly reason: "contract" | "scope" | "evidence") {
    super(`Script write proposal rejected: ${reason}`);
  }
}

export class ScriptWriteProposalConflictError extends Error {
  constructor() { super("Script write proposal identity conflicts with durable state"); }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toolFor(kind: ScriptWriteKind): WriteTool {
  return kind === "workspace" ? SCRIPT_WORKSPACE_WRITE_TOOL_DEFINITION
    : SCRIPT_CONTENT_WRITE_TOOL_DEFINITION;
}

async function assertOwner(db: Knex | Knex.Transaction,
  projectId: number, actorUserId: number): Promise<void> {
  if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0
    || !await db("o_project").where({ id: projectId,
      userId: actorUserId }).first("id")) {
    throw new ScriptWriteProposalRejectedError("scope");
  }
}

async function readSnapshot(db: Knex | Knex.Transaction, projectId: number,
  runId: string): Promise<ScriptWriteApprovalSnapshot | null> {
  const run = await db("o_agentRun").where({ id: runId, projectId,
    role: "scriptAgent", scope: SCRIPT_WRITE_RUN_SCOPE }).first();
  if (!run) return null;
  const approval = await db("o_agentToolApproval").where({ runId }).first();
  const receipt = approval && await db("o_agentToolReceipt")
    .where({ id: approval.receiptId, runId }).first();
  if (!approval || !receipt) throw new ScriptWriteProposalRejectedError("evidence");
  const kind: ScriptWriteKind = receipt.toolName === SCRIPT_WORKSPACE_WRITE_TOOL_DEFINITION.name
    ? "workspace" : receipt.toolName === SCRIPT_CONTENT_WRITE_TOOL_DEFINITION.name
      ? "script" : (() => { throw new ScriptWriteProposalRejectedError("evidence"); })();
  const tool = toolFor(kind);
  const catalog = await db("o_agentToolDefinition")
    .where({ name: tool.name, revision: tool.revision }).first("contractHash");
  if (approval.toolRevision !== tool.revision || receipt.toolRevision !== tool.revision
    || approval.contractHash !== toolDefinitionContractHash(tool)
    || catalog?.contractHash !== approval.contractHash
    || approval.payloadHash !== sha256(approval.payloadJson)
    || receipt.inputHash !== approval.payloadHash
    || receipt.operationId !== approval.operationId) {
    throw new ScriptWriteProposalRejectedError("evidence");
  }
  let preview: unknown;
  try {
    const payload = JSON.parse(approval.payloadJson);
    preview = kind === "workspace"
      ? scriptWorkspaceWritePreview({ payload: scriptWorkspaceWriteInput.parse(payload),
        payloadHash: approval.payloadHash, targetStateHash: approval.targetStateHash })
      : scriptContentWritePreview({ payload: scriptContentWriteInput.parse(payload),
        payloadHash: approval.payloadHash, targetStateHash: approval.targetStateHash });
  } catch { throw new ScriptWriteProposalRejectedError("evidence"); }
  if (JSON.stringify(preview) !== approval.previewJson) {
    throw new ScriptWriteProposalRejectedError("evidence");
  }
  return { id: approval.id, runId, receiptId: receipt.id,
    operationId: approval.operationId, kind,
    toolRevision: tool.revision, payloadHash: approval.payloadHash,
    targetStateHash: approval.targetStateHash,
    status: approval.status, expiresAt: approval.expiresAt,
    preview, runVersion: run.version, runStatus: run.status };
}

/** Proposal only: freezes an exact candidate and target; it cannot mutate production artifacts. */
export function createScriptWriteApprovalRuntime(dependencies: {
  work: DatabaseWork; now(): number; createId(): string; approvalTtlMs?: number;
}) {
  const ttl = dependencies.approvalTtlMs ?? SCRIPT_WRITE_APPROVAL_TTL_MS;
  return {
    async propose(input: ProposeScriptWriteInput): Promise<ScriptWriteApprovalSnapshot> {
      if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0
        || !Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0
        || !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.clientRequestId)
        || !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.operationId)
        || !["workspace", "script"].includes(input.kind) || ttl <= 0) {
        throw new ScriptWriteProposalRejectedError("contract");
      }
      const frozen = input.kind === "workspace"
        ? freezeScriptWritePayload(scriptWorkspaceWriteInput, input.payload)
        : freezeScriptWritePayload(scriptContentWriteInput, input.payload);
      const tool = toolFor(input.kind);
      const contractHash = toolDefinitionContractHash(tool);
      const requestFingerprint = sha256(JSON.stringify({ projectId: input.projectId,
        actorUserId: input.actorUserId, role: "scriptAgent", scope: SCRIPT_WRITE_RUN_SCOPE,
        operationId: input.operationId, toolRevision: tool.revision,
        payloadHash: frozen.payloadHash }));
      const now = dependencies.now();
      return dependencies.work((db) => db.transaction(async (tx) => {
        await assertOwner(tx, input.projectId, input.actorUserId);
        const existing = await tx("o_agentRun").where({ projectId: input.projectId,
          role: "scriptAgent", scope: SCRIPT_WRITE_RUN_SCOPE,
          clientRequestId: input.clientRequestId }).first();
        if (existing) {
          if (existing.requestFingerprint !== requestFingerprint) {
            throw new ScriptWriteProposalConflictError();
          }
          const snapshot = await readSnapshot(tx, input.projectId, existing.id);
          if (!snapshot) throw new ScriptWriteProposalRejectedError("evidence");
          return snapshot;
        }
        const target = input.kind === "workspace"
          ? await scriptWorkspaceTargetState(tx, input.projectId,
            scriptWorkspaceWriteInput.parse(frozen.payload))
          : await scriptContentTargetState(tx, input.projectId,
            scriptContentWriteInput.parse(frozen.payload));
        const preview = input.kind === "workspace"
          ? scriptWorkspaceWritePreview({ payload: scriptWorkspaceWriteInput.parse(frozen.payload),
            payloadHash: frozen.payloadHash, targetStateHash: target.stateHash })
          : scriptContentWritePreview({ payload: scriptContentWriteInput.parse(frozen.payload),
            payloadHash: frozen.payloadHash, targetStateHash: target.stateHash });
        const catalog = await tx("o_agentToolDefinition")
          .where({ name: tool.name, revision: tool.revision }).first();
        if (catalog && catalog.contractHash !== contractHash) {
          throw new ScriptWriteProposalRejectedError("evidence");
        }
        if (!catalog) await tx("o_agentToolDefinition").insert({
          id: dependencies.createId(), name: tool.name, revision: tool.revision,
          contractHash, policy: JSON.stringify(tool.policy), createdAt: now,
        });
        const runId = dependencies.createId();
        const stepId = dependencies.createId();
        const attemptId = dependencies.createId();
        const receiptId = dependencies.createId();
        const approvalId = dependencies.createId();
        await tx("o_agentRun").insert({ id: runId, projectId: input.projectId,
          ...(input.kind === "script" && "effect" in frozen.payload
            && frozen.payload.effect === "update"
            ? { scriptId: frozen.payload.scriptId } : {}),
          role: "scriptAgent", scope: SCRIPT_WRITE_RUN_SCOPE,
          clientRequestId: input.clientRequestId, requestFingerprint,
          input: JSON.stringify({ operationId: input.operationId,
            kind: input.kind, payloadHash: frozen.payloadHash }),
          status: "waiting", waitingReason: "tool-approval",
          attentionReason: "tool-approval-required",
          allowedActions: JSON.stringify(["inspect", "approve", "reject"]),
          version: 1, createdAt: now, updatedAt: now, startedAt: now, fence: 0,
        });
        await tx("o_agentRunStep").insert({ id: stepId, runId, ordinal: 1,
          kind: "tool", logicalTarget: JSON.stringify({ kind: "tool", name: tool.name }),
          promptFingerprint: requestFingerprint, status: "waiting", startedAt: now });
        await tx("o_agentRunAttempt").insert({ id: attemptId, runId, stepId,
          ordinal: 1, reason: "initial", status: "waiting", createdAt: now, startedAt: now });
        await tx("o_agentToolReceipt").insert({ id: receiptId, runId,
          operationId: input.operationId, toolName: tool.name,
          toolRevision: tool.revision, inputHash: frozen.payloadHash,
          status: "pending", createdAt: now, updatedAt: now });
        await tx("o_agentToolApproval").insert({ id: approvalId, runId,
          receiptId, operationId: input.operationId,
          toolRevision: tool.revision, contractHash,
          payloadJson: frozen.payloadJson, payloadHash: frozen.payloadHash,
          targetStateHash: target.stateHash, previewJson: JSON.stringify(preview),
          status: "pending", expiresAt: now + ttl, createdAt: now });
        const checkpoint: AgentRunCheckpointPayload = {
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
          kind: "run-created", runId, stepId, attemptId,
          sequence: 1, runVersion: 1, lastCommittedStepId: null,
          predecessorCheckpointId: null, predecessorPayloadHash: null,
          requestFingerprint,
        };
        await tx("o_agentRunCheckpoint").insert({ id: dependencies.createId(),
          runId, stepId, attemptId, sequence: 1, kind: "run-created",
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
          runVersion: 1, lastCommittedStepId: null,
          predecessorCheckpointId: null,
          payload: canonicalCheckpointPayload(checkpoint),
          payloadHash: hashCheckpointPayload(checkpoint), createdAt: now });
        await appendCausalTrace(tx, { id: dependencies.createId(), runId,
          stepId, attemptId, toolReceiptId: receiptId,
          eventType: "tool.approval.requested", createdAt: now });
        const snapshot = await readSnapshot(tx, input.projectId, runId);
        if (!snapshot) throw new ScriptWriteProposalRejectedError("evidence");
        return snapshot;
      }));
    },
    async inspect(projectId: number, runId: string,
      actorUserId: number): Promise<ScriptWriteApprovalSnapshot | null> {
      return dependencies.work(async (db) => {
        await assertOwner(db, projectId, actorUserId);
        return readSnapshot(db, projectId, runId);
      });
    },
  };
}

export function getDefaultScriptWriteApprovalRuntime() {
  return createScriptWriteApprovalRuntime({ work: (operation) => getDatabaseRuntime().work(operation),
    now: Date.now, createId: uuid });
}
