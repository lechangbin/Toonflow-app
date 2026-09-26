import { createHash } from "node:crypto";

import type { Knex } from "knex";
import { v4 as uuid } from "uuid";

import {
  AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
  AGENT_RUN_OUTPUT_SCHEMA_VERSION,
  canonicalCheckpointPayload, hashCheckpointPayload,
  type AgentRunCheckpointPayload,
} from "@/agentRuntime";
import { assertAgentRunLease, type AgentRunLease } from "@/agentRuntime/lease";
import { appendCausalTrace } from "@/agentRuntime/causalTrace";
import type { DatabaseWork } from "@/database";
import { getDatabaseRuntime } from "@/database";
import { projectTraceSafeDiagnostic } from "@/diagnostics/traceSafeDiagnostics";
import { resolveScriptProposalGrants } from "@/skillRuntime/grants";
import { authorizeBoundSkillDefinition } from "@/skillRuntime/permissions";

import {
  SCRIPT_CONTENT_WRITE_TOOL_DEFINITION,
  SCRIPT_WORKSPACE_WRITE_TOOL_DEFINITION,
  SCRIPT_PROPOSAL_TOOL_DEFINITIONS,
  toolDefinitionContractHash,
} from "./definitions";
import {
  freezeScriptWritePayload, scriptContentWriteInput, scriptContentWritePreview,
  scriptWorkspaceWriteInput, scriptWorkspaceWritePreview,
} from "./scriptWriteContract";
import { ScriptWriteTargetConflictError,
  scriptContentTargetState, scriptWorkspaceTargetState } from "./scriptWriteState";

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

export interface ProposeScriptWriteFromAgentInput {
  projectId: number;
  parentRunId: string;
  skillId: string;
  lease: AgentRunLease;
  operationId: string;
  kind: ScriptWriteKind;
  payload: unknown;
}

export interface DecideScriptWriteInput {
  projectId: number;
  actorUserId: number;
  runId: string;
  approvalId: string;
  clientCommandId: string;
  expectedVersion: number;
  decision: "approve" | "reject";
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
  sourceRunId?: string;
  sourceOperationId?: string;
}

export interface ScriptWriteApprovalReview {
  approval: ScriptWriteApprovalSnapshot;
  payload: ReturnType<typeof scriptWorkspaceWriteInput.parse>
    | ReturnType<typeof scriptContentWriteInput.parse>;
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

function denialDiagnostic(audience: "toolReceipt" | "trace") {
  const projected = projectTraceSafeDiagnostic({
    failureClass: "Tool", stage: "tool-call", kind: "authorizationFailed",
    severity: "error", certainty: "known-no-effect", expectedness: "expected",
    retryDisposition: "never",
  }, audience);
  if (!projected.ok) throw new ScriptWriteProposalRejectedError("evidence");
  return projected.value;
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
  let runInput: { operationId?: unknown; kind?: unknown;
    payloadHash?: unknown; parentRunId?: unknown;
    parentOperationId?: unknown; skillId?: unknown;
    proposalToolRevision?: unknown; proposalContractHash?: unknown };
  try {
    const parsed: unknown = JSON.parse(run.input);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid Run input");
    }
    runInput = parsed as typeof runInput;
  }
  catch { throw new ScriptWriteProposalRejectedError("evidence"); }
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
    || receipt.operationId !== approval.operationId
    || runInput.operationId !== approval.operationId
    || runInput.kind !== kind || runInput.payloadHash !== approval.payloadHash) {
    throw new ScriptWriteProposalRejectedError("evidence");
  }
  const hasSource = runInput.parentRunId !== undefined
    || runInput.parentOperationId !== undefined || runInput.skillId !== undefined
    || runInput.proposalToolRevision !== undefined
    || runInput.proposalContractHash !== undefined;
  if (hasSource) {
    if (typeof runInput.parentRunId !== "string"
      || typeof runInput.parentOperationId !== "string"
      || typeof runInput.skillId !== "string"
      || runInput.parentOperationId !== approval.operationId) {
      throw new ScriptWriteProposalRejectedError("evidence");
    }
    const proposalTool = kind === "workspace"
      ? SCRIPT_PROPOSAL_TOOL_DEFINITIONS.propose_script_workspace_write
      : SCRIPT_PROPOSAL_TOOL_DEFINITIONS.propose_script_content_write;
    const proposalCatalog = await db("o_agentToolDefinition")
      .where({ name: proposalTool.name, revision: proposalTool.revision })
      .first("contractHash");
    if (runInput.proposalToolRevision !== proposalTool.revision
      || runInput.proposalContractHash !== toolDefinitionContractHash(proposalTool)
      || proposalCatalog?.contractHash !== runInput.proposalContractHash) {
      throw new ScriptWriteProposalRejectedError("evidence");
    }
    const parent = await db("o_agentRun").where({ id: runInput.parentRunId,
      projectId, role: "scriptAgent", scope: "script-harness-guidance-v1" }).first("id");
    const permission = parent && await db("o_agentSkillPermissionDecision")
      .where({ runId: parent.id, operationId: runInput.parentOperationId,
        skillId: runInput.skillId,
        toolName: kind === "workspace"
          ? SCRIPT_PROPOSAL_TOOL_DEFINITIONS.propose_script_workspace_write.name
          : SCRIPT_PROPOSAL_TOOL_DEFINITIONS.propose_script_content_write.name })
      .first("decisionJson", "decisionHash");
    if (!parent || !permission || sha256(permission.decisionJson) !== permission.decisionHash) {
      throw new ScriptWriteProposalRejectedError("evidence");
    }
    try {
      if (JSON.parse(permission.decisionJson).allowed !== true) {
        throw new Error("source proposal was denied");
      }
    } catch { throw new ScriptWriteProposalRejectedError("evidence"); }
  }
  const status = approval.status;
  const validStatus = status === "pending" && receipt.status === "pending"
    && run.status === "waiting"
    || status === "approved" && receipt.status === "succeeded"
      && run.status === "succeeded"
    || status === "rejected" && receipt.status === "failed"
      && run.status === "cancelled"
    || ["expired", "conflicted", "corrupt"].includes(status)
      && receipt.status === "failed" && run.status === "waiting";
  if (!validStatus) throw new ScriptWriteProposalRejectedError("evidence");
  if (status === "approved") {
    try {
      if (typeof receipt.outputJson !== "string"
        || sha256(receipt.outputJson) !== receipt.outputHash) {
        throw new Error("invalid approved receipt");
      }
      tool.outputSchema.parse(JSON.parse(receipt.outputJson));
    } catch { throw new ScriptWriteProposalRejectedError("evidence"); }
  } else if (receipt.outputJson != null || receipt.outputHash != null) {
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
    preview, runVersion: run.version, runStatus: run.status,
    ...(hasSource ? { sourceRunId: runInput.parentRunId as string,
      sourceOperationId: runInput.parentOperationId as string } : {}) };
}

/** Reconnect settles expired pending proposals without granting any write effect. */
export async function expireDueScriptWriteApprovals(db: Knex,
  projectId: number | null, now: number, createId: () => string): Promise<void> {
  const due = db("o_agentToolApproval as approval")
    .join("o_agentRun as run", "run.id", "approval.runId")
    .where({ "approval.status": "pending", "run.role": "scriptAgent",
      "run.scope": SCRIPT_WRITE_RUN_SCOPE, "run.status": "waiting" })
    .where("approval.expiresAt", "<=", now);
  if (projectId !== null) due.where("run.projectId", projectId);
  const rows = await due.select("approval.id");
  for (const row of rows) {
    await db.transaction(async (tx) => {
      const current = await tx("o_agentToolApproval as approval")
        .join("o_agentRun as run", "run.id", "approval.runId")
        .where({ "approval.id": row.id, "approval.status": "pending",
          "run.role": "scriptAgent", "run.scope": SCRIPT_WRITE_RUN_SCOPE,
          "run.status": "waiting" })
        .where("approval.expiresAt", "<=", now)
        .select("approval.id", "approval.receiptId", "approval.runId",
          "run.projectId", "run.version").first();
      if (!current || (projectId !== null && current.projectId !== projectId)) return;
      const changed = await tx("o_agentToolApproval")
        .where({ id: current.id, status: "pending" })
        .update({ status: "expired", decidedAt: now });
      if (changed !== 1) return;
      const receiptChanged = await tx("o_agentToolReceipt")
        .where({ id: current.receiptId, status: "pending" })
        .update({ status: "failed",
          diagnostic: JSON.stringify(denialDiagnostic("toolReceipt")),
          updatedAt: now });
      const runChanged = await tx("o_agentRun")
        .where({ id: current.runId, version: current.version, status: "waiting" })
        .update({ waitingReason: "tool-approval-expired",
          attentionReason: "tool-approval-expired",
          allowedActions: JSON.stringify(["inspect"]),
          version: current.version + 1, updatedAt: now });
      if (receiptChanged !== 1 || runChanged !== 1) {
        throw new ScriptWriteProposalRejectedError("evidence");
      }
      await appendCausalTrace(tx, { id: createId(), runId: current.runId,
        toolReceiptId: current.receiptId,
        eventType: "tool.approval.expired", createdAt: now,
        diagnostic: denialDiagnostic("trace") });
    });
  }
}

/** Proposal only: freezes an exact candidate and target; it cannot mutate production artifacts. */
export function createScriptWriteApprovalRuntime(dependencies: {
  work: DatabaseWork; now(): number; createId(): string; approvalTtlMs?: number;
}) {
  const ttl = dependencies.approvalTtlMs ?? SCRIPT_WRITE_APPROVAL_TTL_MS;
  async function persistProposal(input: ProposeScriptWriteInput,
    source?: ProposeScriptWriteFromAgentInput): Promise<ScriptWriteApprovalSnapshot | null> {
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
        payloadHash: frozen.payloadHash,
        ...(source ? { parentRunId: source.parentRunId, skillId: source.skillId } : {}) }));
      const now = dependencies.now();
      return dependencies.work((db) => db.transaction(async (tx) => {
        await assertOwner(tx, input.projectId, input.actorUserId);
        if (source) {
          const parent = await tx("o_agentRun").where({ id: source.parentRunId,
            projectId: input.projectId, role: "scriptAgent",
            scope: "script-harness-guidance-v1", status: "running" })
            .whereNull("cancellationRequestedAt").first("id", "input");
          if (!parent || source.lease.runId !== parent.id) {
            throw new ScriptWriteProposalRejectedError("scope");
          }
          let parentActor: unknown;
          try { parentActor = JSON.parse(parent.input).actorUserId; }
          catch { throw new ScriptWriteProposalRejectedError("evidence"); }
          if (parentActor !== input.actorUserId) {
            throw new ScriptWriteProposalRejectedError("scope");
          }
          await assertAgentRunLease(tx, source.lease, now);
          const proposalTool = source.kind === "workspace"
            ? SCRIPT_PROPOSAL_TOOL_DEFINITIONS.propose_script_workspace_write
            : SCRIPT_PROPOSAL_TOOL_DEFINITIONS.propose_script_content_write;
          const proposalContractHash = toolDefinitionContractHash(proposalTool);
          const proposalCatalog = await tx("o_agentToolDefinition")
            .where({ name: proposalTool.name,
              revision: proposalTool.revision }).first("contractHash");
          if (proposalCatalog && proposalCatalog.contractHash !== proposalContractHash) {
            throw new ScriptWriteProposalRejectedError("evidence");
          }
          if (!proposalCatalog) await tx("o_agentToolDefinition").insert({
            id: dependencies.createId(), name: proposalTool.name,
            revision: proposalTool.revision,
            contractHash: proposalContractHash,
            policy: JSON.stringify(proposalTool.policy), createdAt: now,
          });
          const grants = await resolveScriptProposalGrants(tx, {
            runId: parent.id, projectId: input.projectId, kind: source.kind });
          const authority = await authorizeBoundSkillDefinition(tx, {
            runId: parent.id, projectId: input.projectId,
            skillId: source.skillId, ...grants }, proposalTool);
          const decisionJson = JSON.stringify(authority.decision);
          const previous = await tx("o_agentSkillPermissionDecision")
            .where({ runId: parent.id, operationId: source.operationId }).first();
          if (previous) {
            if (previous.skillId !== source.skillId
              || previous.toolName !== proposalTool.name
              || previous.skillRevisionId !== authority.skillRevisionId
              || previous.decisionHash !== sha256(previous.decisionJson)) {
              throw new ScriptWriteProposalConflictError();
            }
            const recorded = JSON.parse(previous.decisionJson) as { allowed?: unknown };
            if (recorded.allowed !== true || !authority.decision.allowed) return null;
          } else {
            await tx("o_agentSkillPermissionDecision").insert({
              id: dependencies.createId(), runId: parent.id,
              skillId: source.skillId, skillRevisionId: authority.skillRevisionId,
              operationId: source.operationId, toolName: proposalTool.name,
              decisionJson, decisionHash: sha256(decisionJson), createdAt: now,
            });
            if (!authority.decision.allowed) return null;
          }
        }
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
            kind: input.kind, payloadHash: frozen.payloadHash,
            ...(source ? { parentRunId: source.parentRunId,
              parentOperationId: source.operationId, skillId: source.skillId,
              proposalToolRevision: source.kind === "workspace"
                ? SCRIPT_PROPOSAL_TOOL_DEFINITIONS.propose_script_workspace_write.revision
                : SCRIPT_PROPOSAL_TOOL_DEFINITIONS.propose_script_content_write.revision,
              proposalContractHash: toolDefinitionContractHash(source.kind === "workspace"
                ? SCRIPT_PROPOSAL_TOOL_DEFINITIONS.propose_script_workspace_write
                : SCRIPT_PROPOSAL_TOOL_DEFINITIONS.propose_script_content_write) } : {}) }),
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
        if (source) await appendCausalTrace(tx, {
          id: dependencies.createId(), runId: source.parentRunId,
          eventType: "tool.proposal.created", createdAt: now,
        });
        const snapshot = await readSnapshot(tx, input.projectId, runId);
        if (!snapshot) throw new ScriptWriteProposalRejectedError("evidence");
        return snapshot;
      }));
  }
  return {
    async propose(input: ProposeScriptWriteInput): Promise<ScriptWriteApprovalSnapshot> {
      const result = await persistProposal(input);
      if (!result) throw new ScriptWriteProposalRejectedError("evidence");
      return result;
    },
    async proposeFromAgent(source: ProposeScriptWriteFromAgentInput): Promise<
      { status: "denied" } | { status: "pending"; approvalRunId: string; approvalId: string }> {
      const actorUserId = await dependencies.work(async (db) => {
        const project = await db("o_project").where({ id: source.projectId }).first("userId");
        return Number(project?.userId);
      });
      const result = await persistProposal({ projectId: source.projectId,
        actorUserId, clientRequestId: `${source.parentRunId}:${source.operationId}`,
        operationId: source.operationId, kind: source.kind,
        payload: source.payload }, source);
      return result ? { status: "pending", approvalRunId: result.runId,
        approvalId: result.id } : { status: "denied" };
    },
    async inspect(projectId: number, runId: string,
      actorUserId: number): Promise<ScriptWriteApprovalSnapshot | null> {
      return dependencies.work(async (db) => {
        await assertOwner(db, projectId, actorUserId);
        await expireDueScriptWriteApprovals(db, projectId,
          dependencies.now(), dependencies.createId);
        return readSnapshot(db, projectId, runId);
      });
    },
    /** Owner-only full-text review, deliberately separate from content-free list/trace. */
    async review(projectId: number, runId: string, approvalId: string,
      actorUserId: number): Promise<ScriptWriteApprovalReview | null> {
      return dependencies.work(async (db) => {
        await assertOwner(db, projectId, actorUserId);
        await expireDueScriptWriteApprovals(db, projectId,
          dependencies.now(), dependencies.createId);
        const snapshot = await readSnapshot(db, projectId, runId);
        if (!snapshot || snapshot.id !== approvalId) return null;
        if (snapshot.status !== "pending") throw new ScriptWriteProposalConflictError();
        const approval = await db("o_agentToolApproval")
          .where({ id: approvalId, runId, status: "pending" }).first("payloadJson");
        if (!approval) throw new ScriptWriteProposalRejectedError("evidence");
        const payload = snapshot.kind === "workspace"
          ? scriptWorkspaceWriteInput.parse(JSON.parse(approval.payloadJson))
          : scriptContentWriteInput.parse(JSON.parse(approval.payloadJson));
        return { approval: snapshot, payload };
      });
    },
    async list(projectId: number, actorUserId: number): Promise<ScriptWriteApprovalSnapshot[]> {
      return dependencies.work(async (db) => {
        await assertOwner(db, projectId, actorUserId);
        await expireDueScriptWriteApprovals(db, projectId,
          dependencies.now(), dependencies.createId);
        const rows = await db("o_agentRun as run")
          .where({ "run.projectId": projectId, "run.role": "scriptAgent",
            "run.scope": SCRIPT_WRITE_RUN_SCOPE })
          .orderBy("run.createdAt", "desc").orderBy("run.id", "desc")
          .limit(20).select("run.id");
        const snapshots = await Promise.all(rows.map((row) =>
          readSnapshot(db, projectId, row.id)));
        return snapshots.filter((item): item is ScriptWriteApprovalSnapshot => item !== null);
      });
    },
    async decide(input: DecideScriptWriteInput): Promise<ScriptWriteApprovalSnapshot | null> {
      if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0
        || !Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0
        || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion <= 0
        || !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.clientCommandId)
        || !["approve", "reject"].includes(input.decision)) {
        throw new ScriptWriteProposalRejectedError("contract");
      }
      const now = dependencies.now();
      return dependencies.work((db) => db.transaction(async (tx) => {
        await assertOwner(tx, input.projectId, input.actorUserId);
        const run = await tx("o_agentRun").where({ id: input.runId,
          projectId: input.projectId, role: "scriptAgent",
          scope: SCRIPT_WRITE_RUN_SCOPE }).first();
        if (!run) return null;
        const approval = await tx("o_agentToolApproval").where({ id: input.approvalId,
          runId: run.id }).first();
        if (!approval) return null;
        if (approval.decisionCommandId === input.clientCommandId) {
          if (approval.decisionExpectedVersion !== input.expectedVersion
            || approval.decisionKind !== input.decision) {
            throw new ScriptWriteProposalConflictError();
          }
          return readSnapshot(tx, input.projectId, run.id);
        }
        if (approval.decisionCommandId || run.version !== input.expectedVersion
          || run.status !== "waiting" || approval.status !== "pending"
          || run.cancellationRequestedAt != null) {
          throw new ScriptWriteProposalConflictError();
        }
        const snapshot = await readSnapshot(tx, input.projectId, run.id);
        if (!snapshot) throw new ScriptWriteProposalRejectedError("evidence");
        const receipt = await tx("o_agentToolReceipt").where({ id: approval.receiptId,
          runId: run.id, status: "pending" }).first();
        if (!receipt) throw new ScriptWriteProposalRejectedError("evidence");
        const workspacePayload = snapshot.kind === "workspace"
          ? scriptWorkspaceWriteInput.parse(JSON.parse(approval.payloadJson)) : null;
        const scriptPayload = snapshot.kind === "script"
          ? scriptContentWriteInput.parse(JSON.parse(approval.payloadJson)) : null;
        let failure: "rejected" | "expired" | "conflicted" | null =
          now >= approval.expiresAt ? "expired"
            : input.decision === "reject" ? "rejected" : null;
        let target: { rowId?: number | null; scriptId?: number | null;
          stateHash: string } | null = null;
        if (!failure) {
          try {
            target = workspacePayload
              ? await scriptWorkspaceTargetState(tx, input.projectId, workspacePayload)
              : await scriptContentTargetState(tx, input.projectId, scriptPayload!);
            if (target.stateHash !== approval.targetStateHash) failure = "conflicted";
          } catch (error) {
            if (error instanceof ScriptWriteTargetConflictError) failure = "conflicted";
            else throw error;
          }
        }
        if (failure) {
          await tx("o_agentToolApproval").where("id", approval.id).update({
            status: failure, decisionKind: input.decision,
            decisionCommandId: input.clientCommandId,
            decisionExpectedVersion: input.expectedVersion,
            decidedByUserId: input.actorUserId, decidedAt: now,
          });
          await tx("o_agentToolReceipt").where("id", receipt.id).update({
            status: "failed", diagnostic: JSON.stringify(denialDiagnostic("toolReceipt")),
            updatedAt: now,
          });
          const rejected = failure === "rejected";
          await tx("o_agentRun").where("id", run.id).update({
            status: rejected ? "cancelled" : "waiting",
            waitingReason: rejected ? null : `tool-approval-${failure}`,
            attentionReason: rejected ? null : `tool-approval-${failure}`,
            allowedActions: JSON.stringify(["inspect"]), version: run.version + 1,
            updatedAt: now, ...(rejected ? { completedAt: now } : {}),
          });
          if (rejected) {
            await tx("o_agentRunStep").where({ runId: run.id }).update({
              status: "cancelled", completedAt: now });
            await tx("o_agentRunAttempt").where({ runId: run.id }).update({
              status: "cancelled", completedAt: now });
          }
          await appendCausalTrace(tx, { id: dependencies.createId(),
            runId: run.id, toolReceiptId: receipt.id,
            eventType: `tool.approval.${failure}`, createdAt: now,
            ...(rejected ? {} : { diagnostic: denialDiagnostic("trace") }),
          });
          return readSnapshot(tx, input.projectId, run.id);
        }
        let result: { key: "storySkeleton" | "adaptationStrategy";
          contentHash: string } | { scriptId: number;
          effect: "created" | "updated"; contentHash: string };
        if (workspacePayload) {
          const row = target?.rowId === null ? null : await tx("o_agentWorkData")
            .where({ id: target?.rowId, projectId: input.projectId,
              key: "scriptAgent" }).first();
          let data: Record<string, unknown> = {};
          if (row) {
            const parsed: unknown = JSON.parse(row.data ?? "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new ScriptWriteProposalRejectedError("evidence");
            }
            data = parsed as Record<string, unknown>;
          }
          const nextData = { ...data, [workspacePayload.key]: workspacePayload.content };
          if (row) {
            const changed = await tx("o_agentWorkData").where({ id: row.id,
              projectId: input.projectId, key: "scriptAgent" })
              .update({ data: JSON.stringify(nextData), updateTime: now });
            if (changed !== 1) throw new ScriptWriteProposalConflictError();
          } else {
            await tx("o_agentWorkData").insert({ projectId: input.projectId,
              key: "scriptAgent", data: JSON.stringify(nextData),
              createTime: now, updateTime: now });
          }
          result = { key: workspacePayload.key,
            contentHash: sha256(workspacePayload.content) };
        } else {
          const payload = scriptPayload!;
          let scriptId: number;
          if (payload.effect === "create") {
            const [id] = await tx("o_script").insert({ projectId: input.projectId,
              name: payload.name, content: payload.content, createTime: now });
            scriptId = id;
          } else {
            const changed = await tx("o_script").where({ id: payload.scriptId,
              projectId: input.projectId }).update({ name: payload.name,
                content: payload.content });
            if (changed !== 1) throw new ScriptWriteProposalConflictError();
            scriptId = payload.scriptId;
          }
          result = { scriptId, effect: payload.effect === "create" ? "created" : "updated",
            contentHash: sha256(payload.content) };
        }
        const tool = toolFor(snapshot.kind);
        const validatedResult = snapshot.kind === "workspace"
          ? SCRIPT_WORKSPACE_WRITE_TOOL_DEFINITION.outputSchema.parse(result)
          : SCRIPT_CONTENT_WRITE_TOOL_DEFINITION.outputSchema.parse(result);
        const outputJson = JSON.stringify(validatedResult);
        const step = await tx("o_agentRunStep").where({ runId: run.id }).first();
        const attempt = await tx("o_agentRunAttempt").where({ runId: run.id }).first();
        const predecessor = await tx("o_agentRunCheckpoint")
          .where({ runId: run.id }).orderBy("sequence", "desc").first();
        if (!step || !attempt || !predecessor || predecessor.kind !== "run-created") {
          throw new ScriptWriteProposalRejectedError("evidence");
        }
        const outputId = dependencies.createId();
        const outputContent = `${tool.name} committed`;
        const outputContentHash = sha256(JSON.stringify(outputContent));
        await tx("o_agentToolApproval").where("id", approval.id).update({
          status: "approved", decisionKind: input.decision,
          decisionCommandId: input.clientCommandId,
          decisionExpectedVersion: input.expectedVersion,
          decidedByUserId: input.actorUserId, decidedAt: now,
        });
        await tx("o_agentToolReceipt").where("id", receipt.id).update({
          status: "succeeded", outputJson, outputHash: sha256(outputJson),
          updatedAt: now,
        });
        await tx("o_agentRunOutput").insert({ id: outputId,
          runId: run.id, stepId: step.id, kind: "assistant-text",
          content: outputContent, contentHash: outputContentHash,
          schemaVersion: AGENT_RUN_OUTPUT_SCHEMA_VERSION, createdAt: now });
        await tx("o_agentRunStep").where("id", step.id).update({
          status: "succeeded", completedAt: now });
        await tx("o_agentRunAttempt").where("id", attempt.id).update({
          status: "succeeded", completedAt: now });
        await tx("o_agentRun").where("id", run.id).update({
          status: "succeeded", waitingReason: null, attentionReason: null,
          allowedActions: JSON.stringify(["inspect"]), version: run.version + 1,
          lastCommittedStepId: step.id, updatedAt: now, completedAt: now,
        });
        const checkpoint: AgentRunCheckpointPayload = {
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
          kind: "step-committed", runId: run.id, stepId: step.id,
          attemptId: attempt.id, sequence: predecessor.sequence + 1,
          runVersion: run.version + 1, lastCommittedStepId: step.id,
          predecessorCheckpointId: predecessor.id,
          predecessorPayloadHash: predecessor.payloadHash,
          outputId, outputContentHash,
        };
        await tx("o_agentRunCheckpoint").insert({ id: dependencies.createId(),
          runId: run.id, stepId: step.id, attemptId: attempt.id,
          sequence: checkpoint.sequence, kind: "step-committed",
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
          runVersion: checkpoint.runVersion, lastCommittedStepId: step.id,
          predecessorCheckpointId: predecessor.id,
          payload: canonicalCheckpointPayload(checkpoint),
          payloadHash: hashCheckpointPayload(checkpoint), createdAt: now });
        await appendCausalTrace(tx, { id: dependencies.createId(),
          runId: run.id, stepId: step.id, attemptId: attempt.id,
          toolReceiptId: receipt.id,
          eventType: "tool.approval.committed", createdAt: now });
        return readSnapshot(tx, input.projectId, run.id);
      }));
    },
  };
}

export function getDefaultScriptWriteApprovalRuntime() {
  return createScriptWriteApprovalRuntime({ work: (operation) => getDatabaseRuntime().work(operation),
    now: Date.now, createId: uuid });
}
