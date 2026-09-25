import { createHash } from "node:crypto";

import type { Knex } from "knex";

import { AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, canonicalCheckpointPayload,
  hashCheckpointPayload, type AgentRunCheckpointPayload } from "@/agentRuntime";
import { appendCausalTrace } from "@/agentRuntime/causalTrace";
import { assertAgentRunLease, type AgentRunLease } from "@/agentRuntime/lease";
import type { DatabaseWork } from "@/database";
import { resolveProductionVideoProposalGrants } from "@/skillRuntime/grants";
import { authorizeBoundSkillDefinition } from "@/skillRuntime/permissions";

import { PRODUCTION_VIDEO_PROPOSAL_TOOL_DEFINITION,
  VIDEO_GENERATION_TOOL_DEFINITION, toolDefinitionContractHash } from "./definitions";
import { type FrozenVideoApprovalScope,
  type createVideoApprovalScope, frozenVideoApprovalScopeSchema,
  videoApprovalScopeHash } from "./videoApprovalScope";
import { freezeVideoGenerationProposal, videoGenerationProposalInput } from
  "./videoGenerationProposalContract";
import { videoQuoteScopeKey, type VideoQuoteTarget } from "./videoQuotePolicy";

export const VIDEO_GENERATION_APPROVAL_SCOPE = "approved-billable-video-v1";
export const VIDEO_GENERATION_APPROVAL_TTL_MS = 10 * 60_000;
const identifier = /^[A-Za-z0-9._:-]{1,128}$/u;
const tool = VIDEO_GENERATION_TOOL_DEFINITION;
type Scope = ReturnType<typeof createVideoApprovalScope>;
type Status = "pending" | "approved" | "rejected" | "expired";

export class VideoGenerationApprovalConflictError extends Error {
  constructor() { super("Video approval state, target or quote has changed"); }
}

export interface VideoGenerationApprovalSnapshot {
  id: string; runId: string; receiptId: string; operationId: string;
  status: Status; runStatus: string; runVersion: number; expiresAt: number;
  allowedActions: string[]; scopeHash: string;
  payload: FrozenVideoApprovalScope["payload"];
  preview: FrozenVideoApprovalScope["preview"];
  /** Durable local intent/status, not a Provider charge or completion guarantee. */
  vendorRequest: null | { requestId: string; status: string;
    providerTaskId: string | null; artifactStatus: string | null };
  sourceRunId?: string; sourceOperationId?: string;
}

export interface VideoGenerationProposalCommand {
  projectId: number; actorUserId: number; clientRequestId: string;
  operationId: string; payload: unknown;
}

export interface VideoProposalFromAgentInput {
  projectId: number; parentRunId: string; skillId: string;
  lease: AgentRunLease; operationId: string; payload: unknown;
}

export function videoProposalClientRequestId(parentRunId: string,
  operationId: string): string {
  return `video-proposal:${hash(`${parentRunId}:${operationId}`).slice(0, 64)}`;
}

export interface VideoGenerationDecisionCommand {
  projectId: number; actorUserId: number; runId: string; approvalId: string;
  clientCommandId: string; expectedVersion: number; decision: "approve" | "reject";
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function conflict(): never { throw new VideoGenerationApprovalConflictError(); }

async function owner(db: Knex | Knex.Transaction, projectId: number,
  actorUserId: number): Promise<void> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0
    || !Number.isSafeInteger(actorUserId) || actorUserId <= 0
    || !await db("o_project").where({ id: projectId, userId: actorUserId }).first("id")) conflict();
}

function fingerprint(input: VideoGenerationProposalCommand,
  payload: FrozenVideoApprovalScope["payload"],
  source?: VideoProposalFromAgentInput): string {
  return hash({ projectId: input.projectId, actorUserId: input.actorUserId,
    operationId: input.operationId, payload,
    ...(source ? { parentRunId: source.parentRunId,
      skillId: source.skillId } : {}) });
}

function parseFrozen(row: { payloadJson: string; payloadHash: string;
  targetStateHash: string; previewJson: string }, projectId: number): FrozenVideoApprovalScope {
  let raw: FrozenVideoApprovalScope;
  let preview: unknown;
  try { raw = JSON.parse(row.payloadJson) as FrozenVideoApprovalScope; }
  catch { return conflict(); }
  if (!frozenVideoApprovalScopeSchema.safeParse(raw).success) conflict();
  try { preview = JSON.parse(row.previewJson); }
  catch { return conflict(); }
  if (!raw || raw.projectId !== projectId || hash(raw) !== row.payloadHash
    || raw.targetStateHash !== row.targetStateHash
    || !raw.preview || hash(raw.preview) !== hash(preview)
    || !raw.quote || !Number.isSafeInteger(raw.quote.revision)
    || raw.quote.revision <= 0 || !Number.isSafeInteger(raw.quote.estimatedMaxCostMicros)
    || raw.quote.estimatedMaxCostMicros <= 0
    || raw.quote.estimatedMaxCostMicros > 1_000_000_000
    || !/^[A-Z]{3}$/u.test(raw.quote.currency)
    || !/^[a-f0-9]{64}$/u.test(raw.scopeHash)
    || raw.scopeHash !== videoApprovalScopeHash(raw)) conflict();
  const parsed = videoGenerationProposalInput.safeParse(raw.payload);
  if (!parsed.success || raw.payloadHash !== hash(parsed.data)
    || raw.preview.payloadHash !== raw.payloadHash
    || raw.quote.projectId !== projectId) conflict();
  try {
    if (videoQuoteScopeKey({ projectId, vendorId: raw.quote.vendorId,
      modelId: raw.quote.modelId, capabilityId: raw.quote.capabilityId,
      output: raw.quote.output, audio: raw.quote.audio }) !== videoQuoteScopeKey({
      projectId, vendorId: parsed.data.item.vendorId, modelId: parsed.data.item.modelId,
      capabilityId: "text-to-video", output: parsed.data.item.output,
      audio: parsed.data.item.audio })) conflict();
  } catch { return conflict(); }
  return raw;
}

async function snapshot(db: Knex | Knex.Transaction, projectId: number,
  runId: string): Promise<VideoGenerationApprovalSnapshot | null> {
  const run = await db("o_agentRun").where({ id: runId, projectId,
    role: "productionAgent", scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first();
  if (!run) return null;
  const approval = await db("o_agentToolApproval").where({ runId }).first();
  const receipt = approval && await db("o_agentToolReceipt")
    .where({ id: approval.receiptId, runId }).first();
  const catalog = await db("o_agentToolDefinition")
    .where({ name: tool.name, revision: tool.revision }).first("contractHash");
  if (!approval || !receipt || catalog?.contractHash !== toolDefinitionContractHash(tool)
    || approval.contractHash !== catalog.contractHash
    || approval.toolRevision !== tool.revision || receipt.toolName !== tool.name
    || receipt.toolRevision !== tool.revision || receipt.operationId !== approval.operationId
    || receipt.inputHash !== approval.payloadHash
    || !["pending", "approved", "rejected", "expired"].includes(approval.status)) conflict();
  const frozen = parseFrozen(approval, projectId);
  let runInput: { operationId?: unknown; scopeHash?: unknown;
    parentRunId?: unknown; parentOperationId?: unknown;
    skillId?: unknown; proposalContractHash?: unknown };
  try { runInput = JSON.parse(run.input); } catch { return conflict(); }
  if (runInput.operationId !== approval.operationId
    || runInput.scopeHash !== frozen.scopeHash) conflict();
  const hasSource = runInput.parentRunId != null;
  if (hasSource) {
    if (typeof runInput.parentRunId !== "string"
      || typeof runInput.parentOperationId !== "string"
      || typeof runInput.skillId !== "string"
      || runInput.parentOperationId !== approval.operationId
      || run.clientRequestId !== videoProposalClientRequestId(
        runInput.parentRunId, runInput.parentOperationId)
      || runInput.proposalContractHash !== toolDefinitionContractHash(
        PRODUCTION_VIDEO_PROPOSAL_TOOL_DEFINITION)) conflict();
    const parent = await db("o_agentRun").where({ id: runInput.parentRunId,
      projectId, role: "productionAgent", scope: "production-harness-v1" }).first("id");
    const permission = parent && await db("o_agentSkillPermissionDecision")
      .where({ runId: parent.id, operationId: runInput.parentOperationId,
        toolName: PRODUCTION_VIDEO_PROPOSAL_TOOL_DEFINITION.name,
        skillId: runInput.skillId }).first();
    const binding = parent && await db("o_agentRunSkillBinding")
      .where({ runId: parent.id, skillId: runInput.skillId }).first("revisionId");
    let allowed: unknown;
    try { allowed = JSON.parse(permission?.decisionJson ?? "null")?.allowed; }
    catch { return conflict(); }
    if (!permission || !binding
      || binding.revisionId !== permission.skillRevisionId
      || createHash("sha256").update(permission.decisionJson)
      .digest("hex") !== permission.decisionHash
      || allowed !== true) conflict();
  }
  const call = await db("o_agentToolCall")
    .where({ approvalId: approval.id, runId }).first();
  let vendorRequest: VideoGenerationApprovalSnapshot["vendorRequest"] = null;
  if (approval.status === "pending") {
    if (call || run.status !== "waiting" || receipt.status !== "pending") conflict();
  } else if (approval.status === "approved") {
    if (!call) {
      if (run.status !== "waiting" || receipt.status !== "pending") conflict();
    } else {
      const request = await db("o_agentVideoVendorRequest")
        .where({ runId, toolCallId: call.id, projectId,
          scopeHash: frozen.scopeHash }).first();
      if (!request || call.receiptId !== receipt.id
        || call.toolName !== tool.name || call.toolRevision !== tool.revision
        || !["waiting", "succeeded", "cancelled"].includes(run.status)
        || (run.status === "succeeded" && (receipt.status !== "succeeded"
          || request.status !== "succeeded"))
        || (run.status === "cancelled" && receipt.status !== "cancelled")
        || (run.status === "waiting" && receipt.status !== "pending")) conflict();
      const artifact = await db("o_agentVideoArtifact")
        .where({ vendorRequestId: request.id }).first("status");
      if (run.status === "succeeded" && artifact?.status !== "accepted") conflict();
      vendorRequest = { requestId: request.requestId, status: request.status,
        providerTaskId: request.providerTaskId ?? null,
        artifactStatus: artifact?.status ?? null };
    }
  } else if (call || receipt.status !== "cancelled") conflict();
  let allowedActions: string[];
  try { allowedActions = JSON.parse(run.allowedActions); }
  catch { return conflict(); }
  return { id: approval.id, runId, receiptId: receipt.id,
    operationId: approval.operationId, status: approval.status as Status,
    runStatus: run.status, runVersion: run.version, expiresAt: approval.expiresAt,
    allowedActions, scopeHash: frozen.scopeHash,
    payload: frozen.payload, preview: frozen.preview, vendorRequest,
    ...(hasSource ? { sourceRunId: runInput.parentRunId as string,
      sourceOperationId: runInput.parentOperationId as string } : {}) };
}

export async function expireDueVideoGenerationApprovals(db: Knex,
  projectId: number | null, now: number,
  createId: () => string): Promise<void> {
  const query = db("o_agentToolApproval as approval")
    .join("o_agentRun as run", "run.id", "approval.runId")
    .where({ "run.role": "productionAgent",
      "run.scope": VIDEO_GENERATION_APPROVAL_SCOPE, "run.status": "waiting" })
    .whereIn("approval.status", ["pending", "approved"])
    .whereNotExists(db("o_agentToolCall as call")
      .select(db.raw("1")).whereRaw("call.approvalId = approval.id"))
    .where("approval.expiresAt", "<=", now).select("approval.id");
  if (projectId !== null) query.where("run.projectId", projectId);
  const due = await query;
  for (const row of due) await db.transaction(async (tx) => {
    const approval = await tx("o_agentToolApproval as approval")
      .join("o_agentRun as run", "run.id", "approval.runId")
      .where({ "approval.id": row.id,
        "run.scope": VIDEO_GENERATION_APPROVAL_SCOPE, "run.status": "waiting" })
      .whereIn("approval.status", ["pending", "approved"])
      .whereNotExists(tx("o_agentToolCall as call")
        .select(tx.raw("1")).whereRaw("call.approvalId = approval.id"))
      .where("approval.expiresAt", "<=", now)
      .select("approval.id", "approval.runId", "approval.receiptId",
        "run.projectId", "run.version").first();
    if (!approval || projectId !== null && approval.projectId !== projectId) return;
    const changed = await tx("o_agentToolApproval").where({ id: approval.id })
      .whereIn("status", ["pending", "approved"]).update({ status: "expired", decidedAt: now });
    const changedRun = await tx("o_agentRun")
      .where({ id: approval.runId, version: approval.version, status: "waiting" })
      .update({ waitingReason: "tool-approval-expired", attentionReason: "new-approval-required",
        allowedActions: JSON.stringify(["inspect"]), version: approval.version + 1, updatedAt: now });
    const changedReceipt = await tx("o_agentToolReceipt")
      .where({ id: approval.receiptId, status: "pending" })
      .update({ status: "cancelled", updatedAt: now });
    if (changed !== 1 || changedRun !== 1 || changedReceipt !== 1) conflict();
    await appendCausalTrace(tx, { id: createId(), runId: approval.runId,
      toolReceiptId: approval.receiptId, eventType: "tool.video-approval.expired",
      createdAt: now });
  });
}

/** Owner-local approval only. No Vendor ToolCall, GenerationTask or dispatch path exists here. */
export function createVideoGenerationApprovalRuntime(dependencies: {
  work: DatabaseWork; now(): number; createId(): string;
  scope: Scope; quoteInTransaction(tx: Knex.Transaction,
    target: VideoQuoteTarget): Promise<{ revision: number; estimatedMaxCostMicros: number; currency: string }>;
  approvalTtlMs?: number;
}) {
  const ttl = dependencies.approvalTtlMs ?? VIDEO_GENERATION_APPROVAL_TTL_MS;
  async function verifyInside(tx: Knex.Transaction, frozen: FrozenVideoApprovalScope) {
    const target = await freezeVideoGenerationProposal(tx, frozen.projectId, frozen.payload);
    if (target.payloadHash !== frozen.payloadHash
      || target.targetStateHash !== frozen.targetStateHash) conflict();
    const item = frozen.payload.item;
    const quote = await dependencies.quoteInTransaction(tx, { projectId: frozen.projectId,
      vendorId: item.vendorId, modelId: item.modelId,
      capabilityId: "text-to-video", output: item.output, audio: item.audio });
    if (quote.revision !== frozen.quote.revision
      || quote.estimatedMaxCostMicros !== frozen.quote.estimatedMaxCostMicros
      || quote.currency !== frozen.quote.currency) conflict();
  }
  async function persistProposal(input: VideoGenerationProposalCommand,
    source?: VideoProposalFromAgentInput): Promise<VideoGenerationApprovalSnapshot | null> {
      if (!identifier.test(input.clientRequestId) || !identifier.test(input.operationId)
        || !Number.isSafeInteger(ttl) || ttl <= 0) conflict();
      const payload = videoGenerationProposalInput.parse(input.payload);
      const requestFingerprint = fingerprint(input, payload, source);
      const prior = !source && await dependencies.work(async (db) => {
        await owner(db, input.projectId, input.actorUserId);
        return db("o_agentRun").where({ projectId: input.projectId,
          role: "productionAgent", scope: VIDEO_GENERATION_APPROVAL_SCOPE,
          clientRequestId: input.clientRequestId }).first();
      });
      if (prior) {
        if (prior.requestFingerprint !== requestFingerprint) conflict();
        return dependencies.work(async (db) => {
          await expireDueVideoGenerationApprovals(db, input.projectId,
            dependencies.now(), dependencies.createId);
          return await snapshot(db, input.projectId, prior.id) ?? conflict();
        });
      }
      if (source) {
        // Reject a forged or expired parent before asynchronous Vendor capability prep.
        await dependencies.work((db) => db.transaction(async (tx) => {
          await owner(tx, input.projectId, input.actorUserId);
          const parent = await tx("o_agentRun").where({ id: source.parentRunId,
            projectId: input.projectId, role: "productionAgent",
            scope: "production-harness-v1", status: "running" })
            .whereNull("cancellationRequestedAt").first("id", "input");
          if (!parent || source.lease.runId !== parent.id) conflict();
          let parentActor: unknown;
          try { parentActor = JSON.parse(parent.input).actorUserId; }
          catch { return conflict(); }
          if (parentActor !== input.actorUserId) conflict();
          await assertAgentRunLease(tx, source.lease, dependencies.now());
        }));
      }
      const frozen = await dependencies.scope.prepare(input.projectId, payload);
      return dependencies.work((db) => db.transaction(async (tx) => {
        await owner(tx, input.projectId, input.actorUserId);
        const now = dependencies.now();
        if (source) {
          const parent = await tx("o_agentRun").where({ id: source.parentRunId,
            projectId: input.projectId, role: "productionAgent",
            scope: "production-harness-v1", status: "running" })
            .whereNull("cancellationRequestedAt").first("id", "input");
          if (!parent || source.lease.runId !== parent.id) conflict();
          let parentActor: unknown;
          try { parentActor = JSON.parse(parent.input).actorUserId; }
          catch { return conflict(); }
          if (parentActor !== input.actorUserId) conflict();
          await assertAgentRunLease(tx, source.lease, now);
          const proposalTool = PRODUCTION_VIDEO_PROPOSAL_TOOL_DEFINITION;
          const proposalHash = toolDefinitionContractHash(proposalTool);
          const proposalCatalog = await tx("o_agentToolDefinition")
            .where({ name: proposalTool.name, revision: proposalTool.revision })
            .first("contractHash");
          if (proposalCatalog && proposalCatalog.contractHash !== proposalHash) conflict();
          if (!proposalCatalog) await tx("o_agentToolDefinition").insert({
            id: dependencies.createId(), name: proposalTool.name,
            revision: proposalTool.revision, contractHash: proposalHash,
            policy: JSON.stringify(proposalTool.policy), createdAt: now });
          const grants = await resolveProductionVideoProposalGrants(tx, {
            runId: parent.id, projectId: input.projectId });
          const authority = await authorizeBoundSkillDefinition(tx, {
            runId: parent.id, projectId: input.projectId,
            skillId: source.skillId, ...grants }, proposalTool);
          const decisionJson = JSON.stringify(authority.decision);
          const decisionHash = createHash("sha256").update(decisionJson).digest("hex");
          const previous = await tx("o_agentSkillPermissionDecision")
            .where({ runId: parent.id, operationId: source.operationId }).first();
          if (previous) {
            if (previous.skillId !== source.skillId
              || previous.toolName !== proposalTool.name
              || previous.skillRevisionId !== authority.skillRevisionId
              || createHash("sha256").update(previous.decisionJson)
                .digest("hex") !== previous.decisionHash) conflict();
            let allowed: unknown;
            try { allowed = JSON.parse(previous.decisionJson).allowed; }
            catch { return conflict(); }
            if (allowed !== true || !authority.decision.allowed) return null;
          } else {
            await tx("o_agentSkillPermissionDecision").insert({
              id: dependencies.createId(), runId: parent.id, skillId: source.skillId,
              skillRevisionId: authority.skillRevisionId,
              operationId: source.operationId, toolName: proposalTool.name,
              decisionJson, decisionHash, createdAt: now });
            if (!authority.decision.allowed) return null;
          }
        }
        const existing = await tx("o_agentRun").where({ projectId: input.projectId,
          role: "productionAgent", scope: VIDEO_GENERATION_APPROVAL_SCOPE,
          clientRequestId: input.clientRequestId }).first();
        if (existing) {
          if (existing.requestFingerprint !== requestFingerprint) conflict();
          return await snapshot(tx, input.projectId, existing.id) ?? conflict();
        }
        await verifyInside(tx, frozen);
        const contractHash = toolDefinitionContractHash(tool);
        const catalog = await tx("o_agentToolDefinition")
          .where({ name: tool.name, revision: tool.revision }).first("contractHash");
        if (catalog && catalog.contractHash !== contractHash) conflict();
        if (!catalog) await tx("o_agentToolDefinition").insert({ id: dependencies.createId(),
          name: tool.name, revision: tool.revision, contractHash,
          policy: JSON.stringify(tool.policy), createdAt: now });
        const runId = dependencies.createId(), stepId = dependencies.createId();
        const attemptId = dependencies.createId(), receiptId = dependencies.createId();
        const approvalId = dependencies.createId();
        await tx("o_agentRun").insert({ id: runId, projectId: input.projectId,
          scriptId: payload.scriptId, role: "productionAgent", scope: VIDEO_GENERATION_APPROVAL_SCOPE,
          clientRequestId: input.clientRequestId, requestFingerprint,
          input: JSON.stringify({ operationId: input.operationId, scopeHash: frozen.scopeHash,
            ...(source ? { parentRunId: source.parentRunId,
              parentOperationId: source.operationId, skillId: source.skillId,
              proposalContractHash: toolDefinitionContractHash(
                PRODUCTION_VIDEO_PROPOSAL_TOOL_DEFINITION) } : {}) }),
          status: "waiting", waitingReason: "tool-approval", attentionReason: "tool-approval-required",
          allowedActions: JSON.stringify(["inspect", "approve", "reject"]), version: 1,
          createdAt: now, updatedAt: now, startedAt: now, fence: 0 });
        await tx("o_agentRunStep").insert({ id: stepId, runId, ordinal: 1, kind: "tool",
          logicalTarget: JSON.stringify({ kind: "tool", name: tool.name }),
          promptFingerprint: requestFingerprint, status: "waiting", startedAt: now });
        await tx("o_agentRunAttempt").insert({ id: attemptId, runId, stepId,
          ordinal: 1, reason: "initial", status: "waiting", createdAt: now, startedAt: now });
        await tx("o_agentToolReceipt").insert({ id: receiptId, runId,
          operationId: input.operationId, toolName: tool.name,
          toolRevision: tool.revision, inputHash: hash(frozen), status: "pending",
          createdAt: now, updatedAt: now });
        await tx("o_agentToolApproval").insert({ id: approvalId, runId, receiptId,
          operationId: input.operationId, toolRevision: tool.revision,
          contractHash, payloadJson: JSON.stringify(frozen), payloadHash: hash(frozen),
          targetStateHash: frozen.targetStateHash, previewJson: JSON.stringify(frozen.preview),
          status: "pending", expiresAt: now + ttl, createdAt: now });
        const checkpoint: AgentRunCheckpointPayload = {
          schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, kind: "run-created",
          runId, stepId, attemptId, sequence: 1, runVersion: 1,
          lastCommittedStepId: null, predecessorCheckpointId: null,
          predecessorPayloadHash: null, requestFingerprint };
        await tx("o_agentRunCheckpoint").insert({ id: dependencies.createId(), runId,
          stepId, attemptId, sequence: 1, kind: "run-created",
          schemaVersion: checkpoint.schemaVersion, runVersion: 1,
          payload: canonicalCheckpointPayload(checkpoint),
          payloadHash: hashCheckpointPayload(checkpoint), createdAt: now });
        await appendCausalTrace(tx, { id: dependencies.createId(), runId,
          stepId, attemptId, toolReceiptId: receiptId,
          eventType: "tool.video-approval.requested", createdAt: now });
        return await snapshot(tx, input.projectId, runId) ?? conflict();
      }));
  }
  return {
    async propose(input: VideoGenerationProposalCommand): Promise<VideoGenerationApprovalSnapshot> {
      return await persistProposal(input) ?? conflict();
    },
    async proposeFromAgent(source: VideoProposalFromAgentInput): Promise<
      { status: "denied" } | { status: "pending"; approvalRunId: string; approvalId: string }> {
      const actorUserId = await dependencies.work(async (db) => {
        const project = await db("o_project")
          .where({ id: source.projectId }).first("userId");
        return Number(project?.userId);
      });
      const result = await persistProposal({ projectId: source.projectId,
        actorUserId,
        clientRequestId: videoProposalClientRequestId(source.parentRunId,
          source.operationId), operationId: source.operationId,
        payload: source.payload }, source);
      return result ? { status: "pending", approvalRunId: result.runId,
        approvalId: result.id } : { status: "denied" };
    },
    async inspect(projectId: number, runId: string,
      actorUserId: number): Promise<VideoGenerationApprovalSnapshot | null> {
      return dependencies.work(async (db) => {
        await owner(db, projectId, actorUserId);
        await expireDueVideoGenerationApprovals(db, projectId,
          dependencies.now(), dependencies.createId);
        return snapshot(db, projectId, runId);
      });
    },
    async list(projectId: number,
      actorUserId: number): Promise<VideoGenerationApprovalSnapshot[]> {
      return dependencies.work(async (db) => {
        await owner(db, projectId, actorUserId);
        await expireDueVideoGenerationApprovals(db, projectId,
          dependencies.now(), dependencies.createId);
        const rows = await db("o_agentRun").where({ projectId,
          role: "productionAgent", scope: VIDEO_GENERATION_APPROVAL_SCOPE })
          .orderBy("createdAt", "desc").limit(20).select("id");
        const found = await Promise.all(rows.map((row) => snapshot(db, projectId, row.id)));
        return found.filter((row): row is VideoGenerationApprovalSnapshot => row !== null);
      });
    },
    /** Server-only exact scope read. It grants no dispatch authority by itself. */
    async approvedScope(projectId: number, runId: string, approvalId: string,
      actorUserId: number): Promise<FrozenVideoApprovalScope> {
      return dependencies.work(async (db) => {
        await owner(db, projectId, actorUserId);
        const run = await db("o_agentRun").where({ id: runId, projectId,
          role: "productionAgent", scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first();
        const approval = run && await db("o_agentToolApproval")
          .where({ id: approvalId, runId, status: "approved" }).first();
        if (!approval || approval.expiresAt <= dependencies.now()
          || approval.contractHash !== toolDefinitionContractHash(tool)
          || approval.toolRevision !== tool.revision) conflict();
        const checked = await snapshot(db, projectId, runId);
        if (!checked || checked.status !== "approved") conflict();
        return parseFrozen(approval, projectId);
      });
    },
    async decide(input: VideoGenerationDecisionCommand): Promise<VideoGenerationApprovalSnapshot | null> {
      if (!identifier.test(input.clientCommandId)
        || !["approve", "reject"].includes(input.decision)
        || !Number.isSafeInteger(input.expectedVersion)
        || input.expectedVersion <= 0) conflict();
      let frozen: FrozenVideoApprovalScope | null = null;
      if (input.decision === "approve") {
        const before = await dependencies.work(async (db) => {
        await owner(db, input.projectId, input.actorUserId);
        const run = await db("o_agentRun").where({ id: input.runId,
          projectId: input.projectId, scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first("id");
        const approval = run && await db("o_agentToolApproval")
          .where({ id: input.approvalId, runId: input.runId }).first();
        if (!approval) return { frozen: null, already: null };
        if (approval.decisionCommandId === input.clientCommandId
          && approval.decisionKind === input.decision
          && approval.decisionExpectedVersion === input.expectedVersion) {
          return { frozen: null, already: await snapshot(db, input.projectId, input.runId) };
        }
        return { frozen: parseFrozen(approval, input.projectId), already: null };
        });
        if (before.already) return before.already;
        frozen = before.frozen;
      }
      if (frozen) await dependencies.scope.recheck(frozen);
      return dependencies.work((db) => db.transaction(async (tx) => {
        await owner(tx, input.projectId, input.actorUserId);
        const run = await tx("o_agentRun").where({ id: input.runId,
          projectId: input.projectId, role: "productionAgent",
          scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first();
        if (!run) return null;
        const approval = await tx("o_agentToolApproval")
          .where({ id: input.approvalId, runId: run.id }).first();
        if (!approval) return null;
        if (approval.decisionCommandId === input.clientCommandId
          && approval.decisionKind === input.decision
          && approval.decisionExpectedVersion === input.expectedVersion) {
          return snapshot(tx, input.projectId, run.id);
        }
        if (approval.status !== "pending" || run.version !== input.expectedVersion
          || approval.expiresAt <= dependencies.now() || run.status !== "waiting") conflict();
        const stored = parseFrozen(approval, input.projectId);
        if (input.decision === "approve") {
          if (!frozen || hash(stored) !== hash(frozen)) conflict();
          await verifyInside(tx, stored);
        }
        const now = dependencies.now();
        const accepted = input.decision === "approve";
        const changed = await tx("o_agentToolApproval")
          .where({ id: approval.id, status: "pending" }).update({
            status: accepted ? "approved" : "rejected", decisionKind: input.decision,
            decisionCommandId: input.clientCommandId, decisionExpectedVersion: input.expectedVersion,
            decidedByUserId: input.actorUserId, decidedAt: now });
        const changedRun = await tx("o_agentRun")
          .where({ id: run.id, status: "waiting", version: run.version }).update({
            status: accepted ? "waiting" : "cancelled",
            waitingReason: accepted ? "video-dispatch-not-enabled" : null,
            attentionReason: accepted ? "video-dispatch-not-enabled" : null,
            allowedActions: JSON.stringify(["inspect"]), version: run.version + 1,
            updatedAt: now, ...(!accepted ? { completedAt: now } : {}) });
        if (changed !== 1 || changedRun !== 1) conflict();
        if (!accepted) {
          const receiptChanged = await tx("o_agentToolReceipt")
            .where({ id: approval.receiptId, status: "pending" })
            .update({ status: "cancelled", updatedAt: now });
          if (receiptChanged !== 1) conflict();
          await tx("o_agentRunStep").where({ runId: run.id }).update({ status: "cancelled", completedAt: now });
          await tx("o_agentRunAttempt").where({ runId: run.id }).update({ status: "cancelled", completedAt: now });
        }
        await appendCausalTrace(tx, { id: dependencies.createId(), runId: run.id,
          toolReceiptId: approval.receiptId,
          eventType: `tool.video-approval.${input.decision}`, createdAt: now });
        return snapshot(tx, input.projectId, run.id);
      }));
    },
  };
}
