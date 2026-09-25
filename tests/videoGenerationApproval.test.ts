import assert from "node:assert/strict";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import { createVideoApprovalScope } from "../src/controlledTools/videoApprovalScope";
import { createVideoGenerationApprovalRuntime, expireDueVideoGenerationApprovals,
  VideoGenerationApprovalConflictError } from
  "../src/controlledTools/videoGenerationApproval";
import { freezeVideoGenerationProposal } from
  "../src/controlledTools/videoGenerationProposalContract";
import { createVideoArtifactCommitRuntime } from
  "../src/controlledTools/videoArtifactCommit";
import { createVideoQuotePolicy } from "../src/controlledTools/videoQuotePolicy";
import { createVideoRequestLedger } from
  "../src/controlledTools/videoRequestLedger";
import initDB from "../src/lib/initDB";
import { workOf } from "./databaseTestSupport";

const selection = { vendorId: "agnes", modelId: "agnes-video-v2.0",
  capabilityId: "text-to-video" as const, inputs: [],
  output: { presetId: "720p", duration: 5, resolution: "720p",
    aspectRatio: "16:9" as const },
  audio: { generation: "native" as const, enabled: true } };
const payload = { scriptId: 11, item: { trackId: 31, promptRevisionId: 51, ...selection } };
const quoteTarget = { projectId: 7, vendorId: selection.vendorId,
  modelId: selection.modelId, capabilityId: selection.capabilityId,
  output: selection.output, audio: selection.audio };

async function fixture() {
  const db: Knex = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  await initDB(db);
  await db("o_project").insert([{ id: 7, userId: 1 }, { id: 8, userId: 2 }]);
  await db("o_script").insert({ id: 11, projectId: 7 });
  await db("o_videoTrack").insert({ id: 31, projectId: 7, scriptId: 11,
    state: "已完成", promptRevisionId: 51, duration: 5,
    vendorId: selection.vendorId, modelId: selection.modelId,
    capabilityId: selection.capabilityId, inputRefs: JSON.stringify([]),
    outputSelection: JSON.stringify(selection.output),
    audioSelection: JSON.stringify(selection.audio) });
  await db("o_promptRevision").insert({ id: 51, projectId: 7,
    videoTrackId: 31, status: "active", profileId: "agnes/text-v1",
    strategy: "custom", brief: '{"subject":"lantern"}',
    draft: '{"motion":"sways"}', renderedPrompt: "A lantern sways", createdAt: 100 });
  let now = 100;
  let id = 0;
  let commandHash = "c".repeat(64);
  const work = workOf(db);
  const quotePolicy = createVideoQuotePolicy({ work,
    now: () => now, createId: () => `quote-${++id}` });
  await quotePolicy.set({ ...quoteTarget, actorUserId: 1,
    expectedRevision: 0, estimatedMaxCostMicros: 250_000, currency: "USD" });
  const scope = createVideoApprovalScope({
    prepare: async (projectId, raw) => {
      const frozen = await work((current) =>
        freezeVideoGenerationProposal(current, projectId, raw));
      return { payload: frozen.payload, payloadHash: frozen.payloadHash,
        targetStateHash: frozen.targetStateHash, commandHash,
        preview: frozen.preview };
    },
    quote: (target) => quotePolicy.quote(target),
  });
  const approval = createVideoGenerationApprovalRuntime({ work,
    now: () => now, createId: () => `video-${++id}`,
    scope, quoteInTransaction: (tx, target) => quotePolicy.quote(target, tx),
    approvalTtlMs: 1_000 });
  return { db, approval, quotePolicy, scope,
    setNow: (value: number) => { now = value; },
    setCommandHash: (value: string) => { commandHash = value; } };
}

test("Owner-local Video approval persists pending evidence, never dispatches", async () => {
  const context = await fixture();
  const { db, approval } = context;
  try {
    const proposal = { projectId: 7, actorUserId: 1,
      clientRequestId: "request-1", operationId: "operation-1", payload };
    await assert.rejects(approval.propose({ ...proposal, actorUserId: 2 }),
      VideoGenerationApprovalConflictError);
    const pending = await approval.propose(proposal);
    assert.equal(pending.status, "pending");
    assert.equal(pending.preview.quoteRevision, 1);
    assert.equal(pending.vendorRequest, null);
    assert.equal((await approval.propose(proposal)).runId, pending.runId);
    assert.equal((await db("o_agentRun").where({ scope: "approved-billable-video-v1" })).length, 1);
    assert.equal((await db("o_agentToolCall")).length, 0);
    assert.equal((await db("o_generationTask")).length, 0);
    assert.equal((await db("o_productionAction")).length, 0);
    const decision = { projectId: 7, actorUserId: 1, runId: pending.runId,
      approvalId: pending.id, clientCommandId: "decision-1",
      expectedVersion: pending.runVersion, decision: "approve" as const };
    const approved = await approval.decide(decision);
    assert.equal(approved?.status, "approved");
    assert.equal(approved?.runStatus, "waiting");
    assert.deepEqual(approved?.allowedActions, ["inspect"]);
    assert.equal((await approval.decide(decision))?.runVersion, approved?.runVersion);
    assert.equal((await approval.approvedScope(7, pending.runId, pending.id, 1)).scopeHash,
      pending.scopeHash);
    assert.equal((await db("o_agentToolReceipt").where({ runId: pending.runId }).first()).status,
      "pending", "approval is not a generated Video receipt");
    assert.equal((await db("o_agentToolCall")).length, 0);
    assert.equal((await db("o_video")).length, 0);
    await context.quotePolicy.set({ ...quoteTarget, actorUserId: 1,
      expectedRevision: 1, estimatedMaxCostMicros: 300_000, currency: "USD" });
    assert.equal((await approval.decide(decision))?.runVersion, approved?.runVersion,
      "same decision command remains idempotent after the local quote changes");
  } finally { await db.destroy(); }
});

test("Video approval rejects changed quote, Prompt or command before Owner decision", async () => {
  const context = await fixture();
  const { db, approval, quotePolicy } = context;
  try {
    const pending = await approval.propose({ projectId: 7, actorUserId: 1,
      clientRequestId: "request-2", operationId: "operation-2", payload });
    const command = { projectId: 7, actorUserId: 1, runId: pending.runId,
      approvalId: pending.id, clientCommandId: "decision-2",
      expectedVersion: 1, decision: "approve" as const };
    await quotePolicy.set({ ...quoteTarget, actorUserId: 1, expectedRevision: 1,
      estimatedMaxCostMicros: 300_000, currency: "USD" });
    await assert.rejects(approval.decide(command));
    assert.equal((await approval.inspect(7, pending.runId, 1))?.status, "pending");
    await assert.rejects(approval.inspect(7, pending.runId, 2),
      VideoGenerationApprovalConflictError);
    const fresh = await approval.propose({ projectId: 7, actorUserId: 1,
      clientRequestId: "request-3", operationId: "operation-3", payload });
    context.setCommandHash("d".repeat(64));
    await assert.rejects(approval.decide({ ...command, runId: fresh.runId,
      approvalId: fresh.id, clientCommandId: "decision-3" }));
    context.setCommandHash("c".repeat(64));
    await db("o_promptRevision").where({ id: 51 })
      .update({ renderedPrompt: "A changed lantern" });
    await assert.rejects(approval.decide({ ...command, runId: fresh.runId,
      approvalId: fresh.id, clientCommandId: "decision-4" }));
    assert.equal((await db("o_agentToolCall")).length, 0);
  } finally { await db.destroy(); }
});

test("Video rejection and expiration never become Vendor submissions", async () => {
  const context = await fixture();
  const { db, approval } = context;
  try {
    const pending = await approval.propose({ projectId: 7, actorUserId: 1,
      clientRequestId: "request-4", operationId: "operation-4", payload });
    const rejected = await approval.decide({ projectId: 7, actorUserId: 1,
      runId: pending.runId, approvalId: pending.id, clientCommandId: "reject-1",
      expectedVersion: 1, decision: "reject" });
    assert.equal(rejected?.status, "rejected");
    assert.equal(rejected?.runStatus, "cancelled");
    const other = await approval.propose({ projectId: 7, actorUserId: 1,
      clientRequestId: "request-5", operationId: "operation-5", payload });
    context.setNow(1_101);
    await expireDueVideoGenerationApprovals(db, null, 1_101, () => "startup-expiry-trace");
    assert.equal((await approval.inspect(7, other.runId, 1))?.status, "expired");
    assert.equal((await db("o_agentToolCall")).length, 0);
    assert.equal((await db("o_video")).length, 0);
  } finally { await db.destroy(); }
});

test("Owner Video approval snapshot survives durable request and local stop", async () => {
  const context = await fixture();
  const { db, approval, quotePolicy, scope } = context;
  try {
    const pending = await approval.propose({ projectId: 7, actorUserId: 1,
      clientRequestId: "request-stop", operationId: "operation-stop", payload });
    const approved = await approval.decide({ projectId: 7, actorUserId: 1,
      runId: pending.runId, approvalId: pending.id,
      clientCommandId: "decision-stop", expectedVersion: pending.runVersion,
      decision: "approve" });
    assert(approved);
    let id = 0;
    const ledger = createVideoRequestLedger({ work: workOf(db),
      now: () => 200, createId: () => `request-stop-${++id}`,
      recheck: scope.recheck,
      quoteInTransaction: (tx, target) => quotePolicy.quote(target, tx) });
    const frozen = await approval.approvedScope(7, pending.runId, pending.id, 1);
    const intent = await ledger.reserve({ projectId: 7, actorUserId: 1,
      runId: pending.runId, approvalId: pending.id,
      expectedVersion: approved.runVersion, scope: frozen });
    assert.equal((await approval.inspect(7, pending.runId, 1))?.vendorRequest?.requestId,
      intent.requestId);
    await ledger.markSubmissionAmbiguous(intent.requestId);
    const version = (await db("o_agentRun").where({ id: pending.runId }).first()).version;
    await ledger.stopWithoutReplay({ projectId: 7, actorUserId: 1,
      requestId: intent.requestId, expectedVersion: version });
    const stopped = await approval.inspect(7, pending.runId, 1);
    assert.equal(stopped?.runStatus, "cancelled");
    assert.equal(stopped?.vendorRequest?.status, "unknown");
    context.setNow(1_101);
    await expireDueVideoGenerationApprovals(db, null, 1_101,
      () => "request-stop-expiry-trace");
    assert.equal((await approval.inspect(7, pending.runId, 1))?.status, "approved",
      "an approval with a durable request must not be expired into a fresh-dispatch state");
    assert.equal((await approval.list(7, 1)).at(0)?.runStatus, "cancelled");
  } finally { await db.destroy(); }
});

test("Owner Video approval snapshot reports accepted request after local commit", async () => {
  const context = await fixture();
  const { db, approval, quotePolicy, scope } = context;
  try {
    const pending = await approval.propose({ projectId: 7, actorUserId: 1,
      clientRequestId: "request-success", operationId: "operation-success", payload });
    const approved = await approval.decide({ projectId: 7, actorUserId: 1,
      runId: pending.runId, approvalId: pending.id,
      clientCommandId: "decision-success", expectedVersion: pending.runVersion,
      decision: "approve" });
    assert(approved);
    let id = 0;
    const ledger = createVideoRequestLedger({ work: workOf(db),
      now: () => 200, createId: () => `request-success-${++id}`,
      recheck: scope.recheck,
      quoteInTransaction: (tx, target) => quotePolicy.quote(target, tx) });
    const frozen = await approval.approvedScope(7, pending.runId, pending.id, 1);
    const intent = await ledger.reserve({ projectId: 7, actorUserId: 1,
      runId: pending.runId, approvalId: pending.id,
      expectedVersion: approved.runVersion, scope: frozen });
    const artifactHash = "a".repeat(64);
    await db("o_agentVideoArtifact").insert({ id: "artifact-success",
      vendorRequestId: intent.vendorRequestId, trackId: 31,
      mediaPath: `/7/agent-video/${intent.requestId}/${artifactHash}.mp4`,
      contentHash: artifactHash, status: "observed",
      createdAt: 200, updatedAt: 200 });
    await db("o_agentVideoVendorRequest")
      .where({ id: intent.vendorRequestId }).update({ status: "artifact_observed" });
    const run = await db("o_agentRun").where({ id: pending.runId }).first();
    const commit = createVideoArtifactCommitRuntime({ work: workOf(db),
      now: () => 300, createId: () => `commit-${++id}` });
    await commit.commit({ projectId: 7, actorUserId: 1,
      requestId: intent.requestId, expectedVersion: run.version });
    const completed = await approval.inspect(7, pending.runId, 1);
    assert.equal(completed?.runStatus, "succeeded");
    assert.equal(completed?.vendorRequest?.status, "succeeded");
    assert.equal(completed?.vendorRequest?.artifactStatus, "accepted");
  } finally { await db.destroy(); }
});
