import { createHash, randomUUID } from "node:crypto";

import type { Knex } from "knex";
import { appendCausalTrace } from "@/agentRuntime/causalTrace";

import {
  AGENT_RUN_CHECKPOINT_KINDS,
  AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
  canonicalCheckpointPayload,
  hashCheckpointPayload,
  parseCheckpointPayload,
  type AgentRunCheckpointKind,
  type AgentRunCheckpointPayload,
} from "@/agentRuntime/checkpoints";
import {
  assertAgentRunStepTransition,
  assertAgentRunTransition,
  parseAgentRunStatus,
  parseAgentRunStepStatus,
} from "@/agentRuntime/lifecycle";
import { projectTraceSafeDiagnostic, type TraceSafeDiagnostic } from "@/diagnostics/traceSafeDiagnostics";

const INTERRUPTION_REASON = "interrupted-model-call";
const QUEUED_INTERRUPTION_REASON = "interrupted-before-model-call";
const CHECKPOINT_CORRUPT_REASON = "agent-checkpoint-corrupt";
const CHECKPOINT_INCOMPATIBLE_REASON = "agent-checkpoint-incompatible";
const WAITING_ALLOWED_ACTIONS = JSON.stringify(["inspect"]);

interface InterruptedRunRow {
  id: string;
  version: number;
  status: string;
  requestFingerprint: string;
  lastCommittedStepId?: string | null;
  attentionReason?: string | null;
  leaseExpiresAt?: number | null;
}

interface CheckpointRow {
  id: string;
  runId: string;
  stepId: string;
  attemptId: string;
  sequence: number;
  kind: string;
  schemaVersion: string;
  runVersion: number;
  lastCommittedStepId?: string | null;
  predecessorCheckpointId?: string | null;
  payload: string;
  payloadHash: string;
  createdAt: number;
}

interface AttemptRow {
  id: string;
  runId: string;
  stepId: string;
  ordinal: number;
  predecessorAttemptId?: string | null;
  reason: string;
  status: string;
  invocationFingerprint?: string | null;
}

interface ValidCheckpoint extends CheckpointRow {
  kind: AgentRunCheckpointKind;
  parsedPayload: AgentRunCheckpointPayload;
}

function diagnostic(input: Parameters<typeof projectTraceSafeDiagnostic>[0]): TraceSafeDiagnostic {
  const projected = projectTraceSafeDiagnostic(input, "trace");
  if (!projected.ok) throw new Error("Interrupted Agent Run diagnostic contract is invalid");
  return projected.value;
}

const RUNNING_DIAGNOSTIC = diagnostic({
  failureClass: "Vendor", stage: "runtime", kind: "executionFailed", severity: "error",
  certainty: "unknown-effect", expectedness: "unexpected", retryDisposition: "reconcile-first",
  attributes: { operation: INTERRUPTION_REASON },
});
const QUEUED_DIAGNOSTIC = diagnostic({
  failureClass: "Decision", stage: "runtime", kind: "executionFailed", severity: "warning",
  certainty: "known-no-effect", expectedness: "unexpected", retryDisposition: "safe-retry",
  attributes: { operation: QUEUED_INTERRUPTION_REASON },
});
function checkpointEvidenceDiagnostic(reason: string): TraceSafeDiagnostic {
  return diagnostic({
    failureClass: "Artifact", stage: "artifact-persistence", kind: "evidenceIncomplete", severity: "fatal",
    certainty: "unknown-effect", expectedness: "unexpected", retryDisposition: "never",
    attributes: { operation: reason },
  });
}

class IncompatibleCheckpointError extends Error {}

function sameNullable(left: unknown, right: unknown): boolean {
  return (left ?? null) === (right ?? null);
}

async function validateCheckpointChain(
  trx: Knex.Transaction,
  run: InterruptedRunRow,
): Promise<ValidCheckpoint[] | null> {
  const rows = await trx("o_agentRunCheckpoint").where("runId", run.id).orderBy("sequence", "asc") as CheckpointRow[];
  if (rows.length === 0) {
    const attempt = await trx("o_agentRunAttempt").where("runId", run.id).first("id");
    if (attempt || run.lastCommittedStepId) throw new Error("Agent Run checkpoint history is missing");
    return null; // T04 compatibility: do not fabricate history.
  }

  const [steps, attempts, outputRows] = await Promise.all([
    trx("o_agentRunStep").where("runId", run.id).select("id"),
    trx("o_agentRunAttempt").where("runId", run.id).orderBy("ordinal", "asc") as Promise<AttemptRow[]>,
    trx("o_agentRunOutput").where("runId", run.id).select("id", "stepId", "content", "contentHash", "schemaVersion"),
  ]);
  const outputs = outputRows as Array<{ id: string; stepId: string; content: string; contentHash: string; schemaVersion: string }>;
  const stepIds = new Set(steps.map((step: { id: string }) => step.id));
  const attemptById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  const outputById = new Map<string, { id: string; stepId: string; content: string; contentHash: string; schemaVersion: string }>(
    outputs.map((output) => [output.id, output] as const),
  );
  if (attempts.length === 0) throw new Error("Agent Run checkpoint has no Attempt history");
  const attemptsByStep = new Map<string, AttemptRow[]>();
  for (const attempt of attempts) {
    const sameStep = attemptsByStep.get(attempt.stepId) ?? [];
    sameStep.push(attempt);
    attemptsByStep.set(attempt.stepId, sameStep);
  }
  for (const sameStep of attemptsByStep.values()) {
    sameStep.sort((left, right) => left.ordinal - right.ordinal);
    for (let index = 0; index < sameStep.length; index += 1) {
      const attempt = sameStep[index];
      if (attempt.ordinal !== index + 1 || attempt.runId !== run.id || !stepIds.has(attempt.stepId)
        || !sameNullable(attempt.predecessorAttemptId, index === 0 ? null : sameStep[index - 1].id)) {
        throw new Error("Agent Run Attempt causal chain is invalid");
      }
    }
  }

  let predecessor: ValidCheckpoint | undefined;
  let previousRunVersion = 0;
  const validated: ValidCheckpoint[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.schemaVersion !== AGENT_RUN_CHECKPOINT_SCHEMA_VERSION) {
      throw new IncompatibleCheckpointError("Agent Run checkpoint schema is incompatible");
    }
    if (row.sequence !== index + 1 || row.runId !== run.id
      || !(AGENT_RUN_CHECKPOINT_KINDS as readonly unknown[]).includes(row.kind)
      || row.runVersion <= previousRunVersion || row.runVersion > run.version
      || !sameNullable(row.predecessorCheckpointId, predecessor?.id ?? null)) {
      throw new Error("Agent Run checkpoint envelope is invalid");
    }
    const parsedPayload = parseCheckpointPayload(row.payload, row.kind as AgentRunCheckpointKind);
    if (!parsedPayload || canonicalCheckpointPayload(parsedPayload) !== row.payload
      || hashCheckpointPayload(parsedPayload) !== row.payloadHash
      || parsedPayload.runId !== row.runId || parsedPayload.stepId !== row.stepId
      || parsedPayload.attemptId !== row.attemptId || parsedPayload.sequence !== row.sequence
      || parsedPayload.runVersion !== row.runVersion
      || !sameNullable(parsedPayload.lastCommittedStepId, row.lastCommittedStepId)
      || !sameNullable(parsedPayload.predecessorCheckpointId, row.predecessorCheckpointId)
      || !sameNullable(parsedPayload.predecessorPayloadHash, predecessor?.payloadHash ?? null)) {
      throw new Error("Agent Run checkpoint payload evidence is invalid");
    }
    const attempt = attemptById.get(row.attemptId);
    if (!stepIds.has(row.stepId) || !attempt || attempt.stepId !== row.stepId) {
      throw new Error("Agent Run checkpoint references foreign evidence");
    }
    if ((index === 0 && row.kind !== "run-created") || (index > 0 && row.kind === "run-created")) {
      throw new Error("Agent Run checkpoint chain has an invalid creation boundary");
    }
    const sameAttemptPredecessor = [...validated].reverse().find((checkpoint) => checkpoint.attemptId === row.attemptId);
    if (row.kind === "model-call-intent"
      && (!sameAttemptPredecessor || !["run-created", "attempt-created"].includes(sameAttemptPredecessor.kind))) {
      throw new Error("Agent Run model-call intent has no preparing checkpoint");
    }
    if (row.kind === "step-committed"
      && (!predecessor || !["model-call-intent", "vendor-request-intent", "provider-task-observed"].includes(predecessor.kind)
        || predecessor.attemptId !== row.attemptId)) {
      throw new Error("Agent Run Step commit has no matching model-call intent");
    }
    if (row.kind === "run-created" && parsedPayload.kind === "run-created"
      && parsedPayload.requestFingerprint !== run.requestFingerprint) {
      throw new Error("Agent Run checkpoint request fingerprint is invalid");
    }
    if (row.kind === "attempt-created" && parsedPayload.kind === "attempt-created"
      && (attempt.predecessorAttemptId !== parsedPayload.predecessorAttemptId || attempt.reason !== parsedPayload.reason)) {
      throw new Error("Agent Run checkpoint Attempt cause is invalid");
    }
    if (row.kind === "model-call-intent" && parsedPayload.kind === "model-call-intent"
      && attempt.invocationFingerprint !== parsedPayload.invocationFingerprint) {
      throw new Error("Agent Run checkpoint invocation fingerprint is invalid");
    }
    if (row.kind === "vendor-request-intent" && parsedPayload.kind === "vendor-request-intent") {
      const request = await trx("o_agentVendorRequest as request")
        .join("o_agentToolCall as call", "call.id", "request.toolCallId")
        .where({ "request.runId": run.id, "request.requestId": parsedPayload.requestId,
          "request.scopeHash": parsedPayload.scopeHash, "call.stepId": row.stepId,
          "call.attemptId": row.attemptId }).first("request.id");
      if (!request) throw new Error("Agent Run Vendor request checkpoint has no matching intent");
    }
    if (row.kind === "provider-task-observed" && parsedPayload.kind === "provider-task-observed") {
      const request = await trx("o_agentVendorRequest").where({ runId: run.id,
        requestId: parsedPayload.requestId, providerTaskId: parsedPayload.providerTaskId }).first("id");
      if (!request) throw new Error("Agent Run Provider task checkpoint has no matching observation");
    }
    if (row.kind === "step-committed" && parsedPayload.kind === "step-committed") {
      const output = outputById.get(parsedPayload.outputId);
      if (!output || output.stepId !== row.stepId || output.contentHash !== parsedPayload.outputContentHash
        || createHash("sha256").update(output.content).digest("hex") !== output.contentHash
        || output.schemaVersion !== "toonflow.agent-run-output.v1"
        || row.lastCommittedStepId !== row.stepId) {
        throw new Error("Agent Run committed Step evidence is invalid");
      }
      if (predecessor?.kind === "vendor-request-intent" || predecessor?.kind === "provider-task-observed") {
        let committed: { assetId: number; imageId: number; artifactHash: string };
        try { committed = JSON.parse(output.content); }
        catch { throw new Error("Agent Run committed image output is invalid"); }
        const request = await trx("o_agentVendorRequest as request")
          .join("o_agentToolCall as call", "call.id", "request.toolCallId")
          .join("o_agentImageArtifact as artifact", "artifact.vendorRequestId", "request.id")
          .where({ "request.runId": run.id, "request.assetId": committed.assetId,
            "request.imageId": committed.imageId, "request.artifactHash": committed.artifactHash,
            "request.status": "succeeded", "artifact.contentHash": committed.artifactHash,
            "artifact.status": "accepted", "call.stepId": row.stepId, "call.attemptId": row.attemptId })
          .first("request.id");
        if (!request) throw new Error("Agent Run committed image has no accepted artifact");
      }
    }
    const current = { ...row, kind: row.kind as AgentRunCheckpointKind, parsedPayload };
    validated.push(current);
    predecessor = current;
    previousRunVersion = row.runVersion;
  }
  if (!sameNullable(validated.at(-1)?.lastCommittedStepId, run.lastCommittedStepId)) {
    throw new Error("Agent Run committed Step cursor disagrees with its checkpoint chain");
  }
  return validated;
}

async function parkInvalidCheckpointRun(
  trx: Knex.Transaction,
  run: InterruptedRunRow,
  recoveredAt: number,
  reason = CHECKPOINT_CORRUPT_REASON,
): Promise<void> {
  if (run.attentionReason === reason) return;
  const evidenceDiagnostic = checkpointEvidenceDiagnostic(reason);
  const isActive = ["queued", "running"].includes(run.status);
  const activeSteps = await trx("o_agentRunStep").where("runId", run.id).whereIn("status", ["pending", "running"]);
  const stepId = activeSteps.length === 1 ? activeSteps[0].id as string : undefined;
  if (isActive) {
    await trx("o_agentRunStep").where("runId", run.id).whereIn("status", ["pending", "running"]).update({ status: "waiting", completedAt: null });
    await trx("o_agentRunAttempt").where("runId", run.id).whereIn("status", ["preparing", "running"]).update({ status: "waiting", completedAt: null });
  }
  const changed = await trx("o_agentRun").where({ id: run.id, status: run.status, version: run.version }).update({
    ...(isActive ? { status: "waiting", waitingReason: reason, completedAt: null } : {}),
    attentionReason: reason, allowedActions: WAITING_ALLOWED_ACTIONS,
    version: run.version + 1, updatedAt: recoveredAt,
    failureDiagnostic: JSON.stringify(evidenceDiagnostic),
    leaseOwnerId: null, leaseEpoch: null, leaseExpiresAt: null,
  });
  if (changed !== 1) throw new Error("Invalid Agent Run checkpoint recovery lost its state/version precondition");
  const activeAttempt = stepId && await trx("o_agentRunAttempt").where({ runId: run.id, stepId })
    .orderBy("ordinal", "desc").first("id");
  await appendCausalTrace(trx, {
    id: randomUUID(), runId: run.id, ...(stepId ? { stepId } : {}),
    ...(activeAttempt ? { attemptId: activeAttempt.id } : {}), eventType: reason,
    runStatus: isActive ? "waiting" : run.status,
    ...(isActive && stepId ? { stepStatus: "waiting" } : {}),
    diagnostic: evidenceDiagnostic, createdAt: recoveredAt,
  });
}

async function parkLegacyRun(trx: Knex.Transaction, run: InterruptedRunRow, recoveredAt: number): Promise<void> {
  const runStatus = parseAgentRunStatus(run.status);
  const stepStatus = runStatus === "queued" ? "pending" : "running";
  const reason = runStatus === "queued" ? QUEUED_INTERRUPTION_REASON : INTERRUPTION_REASON;
  const projected = runStatus === "queued" ? QUEUED_DIAGNOSTIC : RUNNING_DIAGNOSTIC;
  assertAgentRunTransition(runStatus, "waiting");
  const activeSteps = await trx("o_agentRunStep").where({ runId: run.id, status: stepStatus }).orderBy("ordinal", "asc").select("id", "status");
  const activeStep = activeSteps[0] as { id?: string; status?: string } | undefined;
  if (activeSteps.length !== 1 || !activeStep?.id || !activeStep.status) throw new Error("Interrupted Agent Run must own exactly one active Model Step");
  assertAgentRunStepTransition(parseAgentRunStepStatus(activeStep.status), "waiting");
  const changedStep = await trx("o_agentRunStep").where({ id: activeStep.id, runId: run.id, status: stepStatus }).update({ status: "waiting", completedAt: null });
  const changedRun = await trx("o_agentRun").where({ id: run.id, status: runStatus, version: run.version }).update({
    status: "waiting", waitingReason: reason, attentionReason: reason, allowedActions: WAITING_ALLOWED_ACTIONS,
    version: run.version + 1, updatedAt: recoveredAt, completedAt: null, failureDiagnostic: JSON.stringify(projected),
    leaseOwnerId: null, leaseEpoch: null, leaseExpiresAt: null,
  });
  if (changedStep !== 1 || changedRun !== 1) throw new Error("Interrupted Agent Run recovery lost its state/version precondition");
  await appendCausalTrace(trx, {
    id: randomUUID(), runId: run.id, stepId: activeStep.id,
    eventType: reason, runStatus: "waiting", stepStatus: "waiting",
    diagnostic: projected, createdAt: recoveredAt,
  });
}

async function recoverCheckpointedRun(trx: Knex.Transaction, run: InterruptedRunRow, checkpoints: ValidCheckpoint[], recoveredAt: number): Promise<void> {
  const latest = checkpoints.at(-1)!;
  if (latest.kind === "step-committed") return parkInvalidCheckpointRun(trx, run, recoveredAt);
  const unknownEffect = latest.kind === "model-call-intent";
  const reason = unknownEffect ? INTERRUPTION_REASON : QUEUED_INTERRUPTION_REASON;
  const projected = unknownEffect ? RUNNING_DIAGNOSTIC : QUEUED_DIAGNOSTIC;
  const step = await trx("o_agentRunStep").where({ id: latest.stepId, runId: run.id }).first();
  const attempt = await trx("o_agentRunAttempt").where({ id: latest.attemptId, runId: run.id, stepId: latest.stepId }).first() as AttemptRow | undefined;
  if (!step || !attempt || !["pending", "running"].includes(step.status)
    || !(unknownEffect ? attempt.status === "running" : attempt.status === "preparing")) {
    return parkInvalidCheckpointRun(trx, run, recoveredAt);
  }
  await trx("o_agentRunStep").where("id", step.id).update({ status: "waiting", completedAt: null });
  await trx("o_agentRunAttempt").where("id", attempt.id).update({ status: "waiting", completedAt: null });
  const nextVersion = run.version + 1;
  const changedRun = await trx("o_agentRun").where({ id: run.id, status: run.status, version: run.version }).update({
    status: "waiting", waitingReason: reason, attentionReason: reason, allowedActions: WAITING_ALLOWED_ACTIONS,
    version: nextVersion, updatedAt: recoveredAt, completedAt: null, failureDiagnostic: JSON.stringify(projected),
    leaseOwnerId: null, leaseEpoch: null, leaseExpiresAt: null,
  });
  if (changedRun !== 1) throw new Error("Interrupted Agent Run recovery lost its state/version precondition");

  let traceAttemptId = attempt.id;
  if (!unknownEffect) {
    const successorId = randomUUID();
    traceAttemptId = successorId;
    await trx("o_agentRunAttempt").insert({
      id: successorId, runId: run.id, stepId: step.id, ordinal: attempt.ordinal + 1,
      predecessorAttemptId: attempt.id, reason: "restart-recovery", status: "preparing", createdAt: recoveredAt,
    });
    const payload: AgentRunCheckpointPayload = {
      schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, runId: run.id, stepId: step.id, attemptId: successorId,
      sequence: latest.sequence + 1, runVersion: nextVersion, lastCommittedStepId: run.lastCommittedStepId ?? null,
      predecessorCheckpointId: latest.id, predecessorPayloadHash: latest.payloadHash,
      kind: "attempt-created", reason: "restart-recovery", predecessorAttemptId: attempt.id,
    };
    await trx("o_agentRunCheckpoint").insert({
      id: randomUUID(), runId: run.id, stepId: step.id, attemptId: successorId,
      sequence: payload.sequence, kind: payload.kind, schemaVersion: payload.schemaVersion,
      runVersion: payload.runVersion, lastCommittedStepId: payload.lastCommittedStepId,
      predecessorCheckpointId: payload.predecessorCheckpointId,
      payload: canonicalCheckpointPayload(payload), payloadHash: hashCheckpointPayload(payload), createdAt: recoveredAt,
    });
  }
  await appendCausalTrace(trx, {
    id: randomUUID(), runId: run.id, stepId: step.id, attemptId: traceAttemptId,
    eventType: reason, runStatus: "waiting", stepStatus: "waiting",
    diagnostic: projected, createdAt: recoveredAt,
  });
}

/**
 * Recovers each Run in its own transaction. Pre-intent work gets a new causal
 * Attempt but is never replayed here; post-intent work is parked because the
 * provider effect is unknown. Corrupt/incompatible evidence fails closed.
 */
export async function recoverInterruptedAgentRuns(db: Knex, recoveredAt = Date.now()): Promise<void> {
  const candidateRuns = await db("o_agentRun")
    .where((query) => query.whereIn("status", ["queued", "running"]).orWhereExists(
      db("o_agentRunCheckpoint").select(db.raw("1")).whereRaw("o_agentRunCheckpoint.runId = o_agentRun.id"),
    ).orWhereExists(
      db("o_agentRunAttempt").select(db.raw("1")).whereRaw("o_agentRunAttempt.runId = o_agentRun.id"),
    ))
    .select("id", "version", "status", "requestFingerprint", "lastCommittedStepId", "attentionReason", "leaseExpiresAt") as InterruptedRunRow[];
  for (const candidate of candidateRuns) {
    await db.transaction(async (trx) => {
      const run = await trx("o_agentRun").where({ id: candidate.id, status: candidate.status, version: candidate.version }).first() as InterruptedRunRow | undefined;
      if (!run) return;
      // Readiness may run while another worker is alive. Expiry is the
      // takeover boundary; an unexpired owner must never be parked here.
      if (["queued", "running"].includes(run.status) && Number(run.leaseExpiresAt ?? 0) > recoveredAt) return;
      try {
        const checkpoints = await validateCheckpointChain(trx, run);
        if (checkpoints === null) {
          if (["queued", "running"].includes(run.status)) await parkLegacyRun(trx, run, recoveredAt);
        } else if (["queued", "running"].includes(run.status)) {
          await recoverCheckpointedRun(trx, run, checkpoints, recoveredAt);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Interrupted Agent Run must own")) throw error;
        await parkInvalidCheckpointRun(
          trx,
          run,
          recoveredAt,
          error instanceof IncompatibleCheckpointError ? CHECKPOINT_INCOMPATIBLE_REASON : CHECKPOINT_CORRUPT_REASON,
        );
      }
    });
  }
}
