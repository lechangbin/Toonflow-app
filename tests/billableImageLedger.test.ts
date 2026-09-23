import assert from "node:assert/strict";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import {
  AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
  canonicalCheckpointPayload,
  hashCheckpointPayload,
  type AgentRunCheckpointPayload,
} from "../src/agentRuntime";
import {
  createBillableImageLedger, BillableImageLedgerConflictError, recoverAmbiguousBillableImageRequests,
} from "../src/controlledTools/billableImageLedger";
import { billableImageScopeHash } from "../src/controlledTools/billableImageLifecycle";
import { BILLABLE_IMAGE_TOOL_DEFINITION, toolDefinitionContractHash } from "../src/controlledTools/definitions";
import initDB from "../src/lib/initDB";
import { recoverInterruptedAgentRuns } from "../src/database/agentRunRecovery";

const scope = { projectId: 7, assetId: 10, vendorId: "test-vendor", modelId: "test-model",
  resolution: "1024x1024", maxCalls: 1 as const, estimatedMaxCostMicros: 250_000, currency: "USD" };
const command = { projectId: 7, actorUserId: 1, runId: "run-1", approvalId: "approval-1", expectedVersion: 1 };

async function database(): Promise<Knex> {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await initDB(db);
  await db("o_project").insert({ id: 7, userId: 1 });
  await db("o_assets").insert({ id: 10, projectId: 7, type: "role", name: "asset" });
  await db("o_agentRun").insert({ id: "run-1", projectId: 7, role: "productionAgent", scope: "approved-billable-image-v1",
    clientRequestId: "client-1", requestFingerprint: "fingerprint", input: "{}", status: "waiting",
    waitingReason: "tool-approval", allowedActions: '["inspect"]', version: 1, createdAt: 100, updatedAt: 100 });
  await db("o_agentRunStep").insert({ id: "step-1", runId: "run-1", ordinal: 1, kind: "tool",
    logicalTarget: "generate_asset_image", promptFingerprint: "fingerprint", status: "waiting" });
  await db("o_agentRunAttempt").insert({ id: "attempt-1", runId: "run-1", stepId: "step-1", ordinal: 1,
    reason: "initial", status: "waiting", createdAt: 100 });
  await db("o_agentToolReceipt").insert({ id: "receipt-1", runId: "run-1", operationId: "operation-1",
    toolName: BILLABLE_IMAGE_TOOL_DEFINITION.name, toolRevision: BILLABLE_IMAGE_TOOL_DEFINITION.revision,
    inputHash: billableImageScopeHash(scope), status: "pending", createdAt: 100, updatedAt: 100 });
  await db("o_agentToolApproval").insert({ id: "approval-1", runId: "run-1", receiptId: "receipt-1",
    operationId: "operation-1", toolRevision: BILLABLE_IMAGE_TOOL_DEFINITION.revision,
    contractHash: toolDefinitionContractHash(BILLABLE_IMAGE_TOOL_DEFINITION), payloadJson: JSON.stringify(scope),
    payloadHash: billableImageScopeHash(scope), targetStateHash: "preflight-state", previewJson: "{}",
    status: "approved", expiresAt: 1000, createdAt: 100 });
  const checkpoint: AgentRunCheckpointPayload = { schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
    kind: "run-created", runId: "run-1", stepId: "step-1", attemptId: "attempt-1", sequence: 1,
    runVersion: 1, lastCommittedStepId: null, predecessorCheckpointId: null,
    predecessorPayloadHash: null, requestFingerprint: "fingerprint" };
  await db("o_agentRunCheckpoint").insert({ id: "checkpoint-1", runId: "run-1", stepId: "step-1",
    attemptId: "attempt-1", sequence: 1, kind: "run-created", schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
    runVersion: 1, payload: canonicalCheckpointPayload(checkpoint), payloadHash: hashCheckpointPayload(checkpoint), createdAt: 100 });
  return db;
}

function ledger(db: Knex, verifyPreflight: (tx: Knex.Transaction) => Promise<string> = async () => "preflight-state") {
  let id = 0;
  return createBillableImageLedger({ work: async (operation) => operation(db), now: () => 200,
    createId: () => `generated-${++id}`, verifyPreflight });
}

test("dispatch atomically records ToolCall, VendorRequest and request-identity checkpoint before external call", async () => {
  const db = await database();
  try {
    const runtime = ledger(db);
    const first = await runtime.dispatch(command);
    assert.equal(first.maySubmit, true);
    assert.equal(first.scope.vendorId, "test-vendor");
    assert.equal((await db("o_agentToolCall")).length, 1);
    assert.equal((await db("o_agentVendorRequest")).length, 1);
    const trace = await db("o_agentTrace").where({ runId: "run-1" }).orderBy("sequence");
    assert.deepEqual(trace.map((row) => row.eventType), ["vendor.request.intent-recorded"]);
    assert.equal(trace[0].toolCallId, first.toolCallId);
    assert.equal(trace[0].vendorRequestId, first.vendorRequestId);
    assert.equal(trace[0].attemptId, "attempt-1");
    assert.equal((await db("o_image").where({ id: first.imageId }).first()).state, "等待中");
    const checkpoints = await db("o_agentRunCheckpoint").orderBy("sequence");
    assert.deepEqual(checkpoints.map((row) => row.kind), ["run-created", "vendor-request-intent"]);
    assert.equal(JSON.parse(checkpoints[1].payload).requestId, first.requestId);
    const afterRestart = await ledger(db).dispatch(command);
    assert.equal(afterRestart.maySubmit, false, "a restarted caller may inspect but not resubmit");
    assert.equal(afterRestart.requestId, first.requestId);
    assert.equal(afterRestart.imageId, first.imageId);
    assert.equal((await db("o_agentVendorRequest")).length, 1);
  } finally { await db.destroy(); }
});

test("owner, exact scope, Run version and preflight failure reject before request identity is committed", async () => {
  const db = await database();
  try {
    const runtime = ledger(db);
    await assert.rejects(runtime.dispatch({ ...command, actorUserId: 2 }), BillableImageLedgerConflictError);
    await assert.rejects(runtime.dispatch({ ...command, expectedVersion: 2 }), BillableImageLedgerConflictError);
    await db("o_agentToolApproval").where({ id: "approval-1" }).update({ status: "pending" });
    await assert.rejects(runtime.dispatch(command), BillableImageLedgerConflictError);
    await db("o_agentToolApproval").where({ id: "approval-1" }).update({ status: "approved" });
    await assert.rejects(ledger(db, async () => { throw new Error("stale prompt"); }).dispatch(command), /stale prompt/);
    await assert.rejects(ledger(db, async () => "changed-state").dispatch(command), BillableImageLedgerConflictError);
    assert.equal((await db("o_agentVendorRequest")).length, 0);
    assert.equal((await db("o_agentRunCheckpoint")).length, 1);
  } finally { await db.destroy(); }
});

test("ambiguous submission survives restart without replay; verified task ID is checkpointed before polling", async () => {
  const db = await database();
  try {
    const runtime = ledger(db);
    const dispatched = await runtime.dispatch(command);
    await runtime.markSubmissionAmbiguous(dispatched.requestId);
    const unknown = await db("o_agentVendorRequest").where({ requestId: dispatched.requestId }).first();
    assert.equal(unknown.status, "unknown");
    assert.deepEqual(JSON.parse((await db("o_agentRun").where({ id: "run-1" }).first()).allowedActions),
      ["wait", "reconcile_manual", "cancel"]);
    assert.equal((await ledger(db).dispatch(command)).maySubmit, false);
    await runtime.recordProviderTask(dispatched.requestId, "provider-task-1");
    const found = await db("o_agentVendorRequest").where({ requestId: dispatched.requestId }).first();
    assert.equal(found.status, "submitted");
    assert.equal(found.providerTaskId, "provider-task-1");
    const checkpoints = await db("o_agentRunCheckpoint").orderBy("sequence");
    assert.deepEqual(checkpoints.map((row) => row.kind),
      ["run-created", "vendor-request-intent", "provider-task-observed"]);
    assert.equal(JSON.parse(checkpoints[2].payload).providerTaskId, "provider-task-1");
    await runtime.recordProviderTask(dispatched.requestId, "provider-task-1");
    assert.equal((await db("o_agentRunCheckpoint")).length, 3);
    await assert.rejects(runtime.recordProviderTask(dispatched.requestId, "provider-task-2"), BillableImageLedgerConflictError);
  } finally { await db.destroy(); }
});

test("startup parks a committed dispatch intent as unknown without issuing another Provider call", async () => {
  const db = await database();
  try {
    const dispatched = await ledger(db).dispatch(command);
    await recoverAmbiguousBillableImageRequests(db, 300);
    await recoverAmbiguousBillableImageRequests(db, 301);
    await recoverInterruptedAgentRuns(db, 302);
    assert.equal((await db("o_agentVendorRequest").where({ id: dispatched.vendorRequestId }).first()).status, "unknown");
    assert.equal((await db("o_agentRunStep").where({ id: "step-1" }).first()).status, "waiting");
    assert.equal((await db("o_agentRunAttempt").where({ id: "attempt-1" }).first()).status, "waiting");
    const traces = await db("o_agentTrace").where({ runId: "run-1" }).orderBy("sequence");
    assert.deepEqual(traces.map((row) => row.eventType),
      ["vendor.request.intent-recorded", "vendor.request.unknown-on-recovery"]);
    assert.equal(traces[1].predecessorTraceId, traces[0].id);
    assert.equal(traces[1].vendorRequestId, dispatched.vendorRequestId);
    assert.equal((await db("o_agentRun").where({ id: "run-1" }).first()).attentionReason, "vendor-reconciliation-required");
    assert.equal((await ledger(db).dispatch(command)).maySubmit, false);
  } finally { await db.destroy(); }
});

test("cancellation records intent and freezes the image without claiming a Provider refund", async () => {
  const db = await database();
  try {
    const runtime = ledger(db);
    const dispatched = await runtime.dispatch(command);
    const version = (await db("o_agentRun").where({ id: "run-1" }).first()).version;
    await assert.rejects(runtime.requestCancellation({ projectId: 7, actorUserId: 2,
      requestId: dispatched.requestId, expectedVersion: version }), BillableImageLedgerConflictError);
    await runtime.requestCancellation({ projectId: 7, actorUserId: 1,
      requestId: dispatched.requestId, expectedVersion: version });
    assert.equal((await db("o_image").where({ id: dispatched.imageId }).first()).state, "已取消");
    const request = await db("o_agentVendorRequest").where({ requestId: dispatched.requestId }).first();
    assert.equal(request.status, "cancelled");
    assert.ok(request.cancellationRequestedAt);
    assert.equal((await db("o_agentRun").where({ id: "run-1" }).first()).status, "waiting");
    await runtime.requestCancellation({ projectId: 7, actorUserId: 1,
      requestId: dispatched.requestId, expectedVersion: version });
    assert.equal((await db("o_agentVendorRequest").where({ requestId: dispatched.requestId }).first()).version, request.version);
  } finally { await db.destroy(); }
});
