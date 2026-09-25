import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createVideoApprovalScope } from "../src/controlledTools/videoApprovalScope";
import { createVideoGenerationApprovalRuntime } from
  "../src/controlledTools/videoGenerationApproval";
import { freezeVideoGenerationProposal } from
  "../src/controlledTools/videoGenerationProposalContract";
import { createVideoQuotePolicy } from "../src/controlledTools/videoQuotePolicy";
import { createVideoRequestLedger, recoverAmbiguousVideoRequests,
  VideoRequestLedgerConflictError } from "../src/controlledTools/videoRequestLedger";
import initDB from "../src/lib/initDB";
import { workOf } from "./databaseTestSupport";

const selection = { vendorId: "agnes", modelId: "model", capabilityId: "text-to-video" as const,
  inputs: [], output: { presetId: "720p", duration: 5,
    resolution: "720p", aspectRatio: "16:9" as const },
  audio: { generation: "native" as const, enabled: true } };
const payload = { scriptId: 11, item: { trackId: 31, promptRevisionId: 51, ...selection } };
const quoteTarget = { projectId: 7, vendorId: selection.vendorId,
  modelId: selection.modelId, capabilityId: selection.capabilityId,
  output: selection.output, audio: selection.audio };

async function fixture() {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  await initDB(db);
  await db("o_project").insert({ id: 7, userId: 1 });
  await db("o_script").insert({ id: 11, projectId: 7 });
  await db("o_videoTrack").insert({ id: 31, projectId: 7, scriptId: 11,
    state: "已完成", promptRevisionId: 51, duration: 5,
    vendorId: selection.vendorId, modelId: selection.modelId,
    capabilityId: selection.capabilityId, inputRefs: "[]",
    outputSelection: JSON.stringify(selection.output),
    audioSelection: JSON.stringify(selection.audio) });
  await db("o_promptRevision").insert({ id: 51, projectId: 7,
    videoTrackId: 31, status: "active", profileId: "agnes/text-v1",
    strategy: "custom", brief: "{}", draft: "{}",
    renderedPrompt: "A lantern sways", createdAt: 100 });
  let now = 100;
  let next = 0;
  let commandHash = "c".repeat(64);
  const work = workOf(db);
  const quote = createVideoQuotePolicy({ work, now: () => now,
    createId: () => `quote-${++next}` });
  await quote.set({ ...quoteTarget, actorUserId: 1,
    expectedRevision: 0, estimatedMaxCostMicros: 250_000, currency: "USD" });
  const scope = createVideoApprovalScope({
    prepare: async (projectId, raw) => {
      const frozen = await work((current) =>
        freezeVideoGenerationProposal(current, projectId, raw));
      return { payload: frozen.payload, payloadHash: frozen.payloadHash,
        targetStateHash: frozen.targetStateHash, commandHash,
        preview: frozen.preview };
    }, quote: (target) => quote.quote(target),
  });
  const approval = createVideoGenerationApprovalRuntime({ work,
    now: () => now, createId: () => `video-${++next}`, scope,
    quoteInTransaction: (tx, target) => quote.quote(target, tx) });
  const ledger = createVideoRequestLedger({ work,
    now: () => now, createId: () => `request-${++next}`,
    recheck: scope.recheck,
    quoteInTransaction: (tx, target) => quote.quote(target, tx) });
  const pending = await approval.propose({ projectId: 7, actorUserId: 1,
    clientRequestId: "candidate-1", operationId: "operation-1", payload });
  const approved = await approval.decide({ projectId: 7, actorUserId: 1,
    runId: pending.runId, approvalId: pending.id,
    clientCommandId: "decision-1", expectedVersion: 1, decision: "approve" });
  assert(approved);
  const frozen = await approval.approvedScope(7, pending.runId, pending.id, 1);
  const reserve = { projectId: 7, actorUserId: 1, runId: pending.runId,
    approvalId: pending.id, expectedVersion: approved.runVersion, scope: frozen };
  return { db, approval, ledger, quote, reserve,
    setNow: (value: number) => { now = value; },
    setCommandHash: (value: string) => { commandHash = value; } };
}

test("Video request intent is durable before any Provider call and never reserved twice", async () => {
  const context = await fixture();
  const { db, ledger, reserve } = context;
  try {
    await assert.rejects(ledger.reserve({ ...reserve, actorUserId: 2 }),
      VideoRequestLedgerConflictError);
    const first = await ledger.reserve(reserve);
    assert.equal(first.newIntent, true);
    assert.equal(first.status, "dispatch_recorded");
    assert.equal((await db("o_agentVideoVendorRequest")).length, 1);
    assert.equal((await db("o_agentToolCall")).length, 1);
    assert.equal((await db("o_generationTask")).length, 0);
    assert.equal((await db("o_video")).length, 0);
    const repeated = await ledger.reserve(reserve);
    assert.equal(repeated.newIntent, false);
    assert.equal(repeated.requestId, first.requestId);
    assert.equal((await db("o_agentVideoVendorRequest")).length, 1);
    await assert.rejects(db("o_agentVideoVendorRequest")
      .where({ id: first.vendorRequestId }).update({ commandHash: "x".repeat(64) }),
    /identity is immutable/);
  } finally { await db.destroy(); }
});

test("Video reservation refuses changed quote, target or prepared command", async () => {
  const context = await fixture();
  const { db, ledger, quote, reserve } = context;
  try {
    context.setCommandHash("d".repeat(64));
    await assert.rejects(ledger.reserve(reserve));
    context.setCommandHash("c".repeat(64));
    await quote.set({ ...quoteTarget, actorUserId: 1, expectedRevision: 1,
      estimatedMaxCostMicros: 300_000, currency: "USD" });
    await assert.rejects(ledger.reserve(reserve));
    assert.equal((await db("o_agentVideoVendorRequest")).length, 0);
  } finally { await db.destroy(); }
});

test("startup marks unacknowledged Video request unknown and never issues a second intent", async () => {
  const context = await fixture();
  const { db, ledger, reserve } = context;
  try {
    const first = await ledger.reserve(reserve);
    context.setNow(200);
    await recoverAmbiguousVideoRequests(db, 200, () => "recovery-trace");
    const rows = await db("o_agentVideoVendorRequest");
    assert.equal(rows[0].status, "unknown");
    const repeated = await ledger.reserve(reserve);
    assert.equal(repeated.newIntent, false);
    assert.equal(repeated.requestId, first.requestId);
    assert.equal(repeated.status, "unknown");
    assert.equal((await db("o_agentVideoVendorRequest")).length, 1);
    assert.equal((await db("o_agentRun").where({ id: reserve.runId }).first()).waitingReason,
      "vendor-submission-unknown");
  } finally { await db.destroy(); }
});

test("verified Video Provider task can be observed once without claiming an Artifact", async () => {
  const context = await fixture();
  const { db, ledger, reserve } = context;
  try {
    const intent = await ledger.reserve(reserve);
    await ledger.recordProviderTask(intent.requestId, "provider-task-1");
    await ledger.recordProviderTask(intent.requestId, "provider-task-1");
    await assert.rejects(ledger.recordProviderTask(intent.requestId, "provider-task-2"),
      VideoRequestLedgerConflictError);
    const request = await db("o_agentVideoVendorRequest")
      .where({ requestId: intent.requestId }).first();
    assert.equal(request.status, "submitted");
    assert.equal(request.providerTaskId, "provider-task-1");
    await assert.rejects(db("o_agentVideoVendorRequest")
      .where({ requestId: intent.requestId })
      .update({ providerTaskId: "provider-task-2" }),
    /observation cannot be replaced/);
    assert.equal((await db("o_agentRunCheckpoint")
      .where({ runId: reserve.runId, kind: "provider-task-observed" })).length, 1);
    assert.equal((await db("o_video")).length, 0);
    await recoverAmbiguousVideoRequests(db, 200, () => "unused-recovery");
    assert.equal((await db("o_agentVideoVendorRequest")
      .where({ requestId: intent.requestId }).first()).status, "submitted");
  } finally { await db.destroy(); }
});

test("ambiguous Video submission may later attach verified task identity, never resubmit", async () => {
  const context = await fixture();
  const { db, ledger, reserve } = context;
  try {
    const intent = await ledger.reserve(reserve);
    await ledger.markSubmissionAmbiguous(intent.requestId);
    await ledger.markSubmissionAmbiguous(intent.requestId);
    assert.equal((await ledger.reserve(reserve)).newIntent, false);
    await ledger.recordProviderTask(intent.requestId, "late-provider-task");
    assert.equal((await db("o_agentVideoVendorRequest")
      .where({ requestId: intent.requestId }).first()).status, "submitted");
    assert.equal((await db("o_video")).length, 0);
  } finally { await db.destroy(); }
});

test("Video cancellation records only local intent, then stops without replay", async () => {
  const context = await fixture();
  const { db, ledger, reserve } = context;
  try {
    const intent = await ledger.reserve(reserve);
    const version = (await db("o_agentRun").where({ id: reserve.runId }).first()).version;
    await assert.rejects(ledger.requestCancellation({ projectId: 7,
      actorUserId: 2, requestId: intent.requestId, expectedVersion: version }),
    VideoRequestLedgerConflictError);
    await ledger.requestCancellation({ projectId: 7, actorUserId: 1,
      requestId: intent.requestId, expectedVersion: version });
    await ledger.requestCancellation({ projectId: 7, actorUserId: 1,
      requestId: intent.requestId, expectedVersion: version });
    const request = await db("o_agentVideoVendorRequest")
      .where({ requestId: intent.requestId }).first();
    assert.equal(request.status, "cancellation_requested");
    assert(request.cancellationRequestedAt != null);
    await assert.rejects(db("o_agentVideoVendorRequest")
      .where({ id: intent.vendorRequestId })
      .update({ cancellationRequestedAt: null }),
    /cancellation intent is immutable/);
    assert.equal((await ledger.reserve(reserve)).newIntent, false);
    await ledger.markSubmissionAmbiguous(intent.requestId);
    const waiting = await db("o_agentRun").where({ id: reserve.runId }).first();
    assert.equal(waiting.waitingReason, "vendor-cancellation-unconfirmed");
    assert.equal(waiting.allowedActions, '["inspect","stop"]');
    await ledger.stopWithoutReplay({ projectId: 7, actorUserId: 1,
      requestId: intent.requestId, expectedVersion: waiting.version });
    assert.equal((await db("o_agentRun").where({ id: reserve.runId }).first()).status,
      "cancelled");
    assert.equal((await db("o_agentToolCall")).at(0)?.status, "cancelled");
    assert.equal((await db("o_agentVideoVendorRequest")
      .where({ requestId: intent.requestId }).first()).status,
      "cancellation_requested");
    assert.equal((await db("o_video")).length, 0);
  } finally { await db.destroy(); }
});

test("late Provider task identity survives cancellation and cannot reopen a stopped Run", async () => {
  const context = await fixture();
  const { db, ledger, reserve } = context;
  try {
    const intent = await ledger.reserve(reserve);
    const version = (await db("o_agentRun").where({ id: reserve.runId }).first()).version;
    await ledger.requestCancellation({ projectId: 7, actorUserId: 1,
      requestId: intent.requestId, expectedVersion: version });
    const waiting = await db("o_agentRun").where({ id: reserve.runId }).first();
    await ledger.stopWithoutReplay({ projectId: 7, actorUserId: 1,
      requestId: intent.requestId, expectedVersion: waiting.version });
    await ledger.recordProviderTask(intent.requestId, "provider-task-late");
    await ledger.recordProviderTask(intent.requestId, "provider-task-late");
    const request = await db("o_agentVideoVendorRequest")
      .where({ requestId: intent.requestId }).first();
    const run = await db("o_agentRun").where({ id: reserve.runId }).first();
    assert.equal(request.providerTaskId, "provider-task-late");
    assert.equal(request.status, "cancellation_requested");
    assert.equal(run.status, "cancelled");
    assert.equal(run.allowedActions, '["inspect"]');
    assert.equal((await db("o_video")).length, 0);
  } finally { await db.destroy(); }
});
