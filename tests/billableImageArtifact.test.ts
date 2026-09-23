import assert from "node:assert/strict";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import {
  AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, canonicalCheckpointPayload,
  hashCheckpointPayload, type AgentRunCheckpointPayload,
} from "../src/agentRuntime";
import { createBillableImageArtifactRuntime } from "../src/controlledTools/billableImageArtifact";
import { createBillableImageCommitRuntime } from "../src/controlledTools/billableImageCommit";
import { createBillableImageLedger, BillableImageLedgerConflictError } from "../src/controlledTools/billableImageLedger";
import { billableImageScopeHash } from "../src/controlledTools/billableImageLifecycle";
import { BILLABLE_IMAGE_TOOL_DEFINITION, toolDefinitionContractHash } from "../src/controlledTools/definitions";
import initDB from "../src/lib/initDB";
import { recoverInterruptedAgentRuns } from "../src/database/agentRunRecovery";

const scope = { projectId: 7, assetId: 10, vendorId: "vendor", modelId: "model", resolution: "1K",
  maxCalls: 1 as const, estimatedMaxCostMicros: 200_000, currency: "USD" };
const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
const otherPng = Buffer.from("89504e470d0a1a0a01", "hex").toString("base64");

async function database(): Promise<Knex> {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await initDB(db);
  await db("o_project").insert({ id: 7, userId: 1 });
  await db("o_assets").insert({ id: 10, projectId: 7, type: "role", name: "Asset" });
  await db("o_agentRun").insert({ id: "run", projectId: 7, role: "productionAgent", scope: "approved-billable-image-v1",
    clientRequestId: "client", requestFingerprint: "fingerprint", input: "{}", status: "waiting",
    allowedActions: '["inspect"]', version: 1, createdAt: 1, updatedAt: 1 });
  await db("o_agentRunStep").insert({ id: "step", runId: "run", ordinal: 1, kind: "tool", logicalTarget: "{}",
    promptFingerprint: "fingerprint", status: "waiting" });
  await db("o_agentRunAttempt").insert({ id: "attempt", runId: "run", stepId: "step", ordinal: 1,
    reason: "initial", status: "waiting", createdAt: 1 });
  await db("o_agentToolReceipt").insert({ id: "receipt", runId: "run", operationId: "operation",
    toolName: BILLABLE_IMAGE_TOOL_DEFINITION.name, toolRevision: BILLABLE_IMAGE_TOOL_DEFINITION.revision,
    inputHash: billableImageScopeHash(scope), status: "pending", createdAt: 1, updatedAt: 1 });
  await db("o_agentToolApproval").insert({ id: "approval", runId: "run", receiptId: "receipt",
    operationId: "operation", toolRevision: BILLABLE_IMAGE_TOOL_DEFINITION.revision,
    contractHash: toolDefinitionContractHash(BILLABLE_IMAGE_TOOL_DEFINITION), payloadJson: JSON.stringify(scope),
    payloadHash: billableImageScopeHash(scope), targetStateHash: "state", previewJson: "{}",
    status: "approved", expiresAt: 9999, createdAt: 1 });
  const checkpoint: AgentRunCheckpointPayload = { schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
    kind: "run-created", runId: "run", stepId: "step", attemptId: "attempt", sequence: 1,
    runVersion: 1, lastCommittedStepId: null, predecessorCheckpointId: null,
    predecessorPayloadHash: null, requestFingerprint: "fingerprint" };
  await db("o_agentRunCheckpoint").insert({ id: "cp", runId: "run", stepId: "step", attemptId: "attempt",
    sequence: 1, kind: "run-created", schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION, runVersion: 1,
    payload: canonicalCheckpointPayload(checkpoint), payloadHash: hashCheckpointPayload(checkpoint), createdAt: 1 });
  return db;
}

function runtimes(db: Knex) {
  let id = 0;
  const work = async <T>(operation: (db: Knex) => Promise<T> | T) => operation(db);
  const ledger = createBillableImageLedger({ work, now: () => 100, createId: () => `id-${++id}`,
    verifyPreflight: async () => "state" });
  const writes: string[] = [];
  const artifact = createBillableImageArtifactRuntime({ work, now: () => 101,
    createId: () => `artifact-${++id}`, writeMedia: async (path) => { writes.push(path); } });
  const commit = createBillableImageCommitRuntime({ work, now: () => 102,
    createId: () => `commit-${++id}`, verifyPreflight: async () => "state" });
  return { ledger, artifact, commit, writes };
}

test("duplicate callback stores one artifact and a conflicting result cannot replace it", async () => {
  const db = await database();
  try {
    const { ledger, artifact, writes } = runtimes(db);
    const dispatched = await ledger.dispatch({ projectId: 7, actorUserId: 1, runId: "run", approvalId: "approval", expectedVersion: 1 });
    const first = await artifact.observe(dispatched.requestId, png);
    assert.equal(first.status, "observed");
    assert.equal(first.duplicate, false);
    assert.equal((await artifact.observe(dispatched.requestId, png)).duplicate, true);
    assert.equal(writes.length, 1);
    assert.equal((await db("o_agentImageArtifact")).length, 1);
    assert.equal((await db("o_image").where({ id: dispatched.imageId }).first()).state, "等待中",
      "observed media is not a committed production image");
    await assert.rejects(artifact.observe(dispatched.requestId, otherPng), BillableImageLedgerConflictError);
    await assert.rejects(artifact.inspect(7, 2, dispatched.requestId), BillableImageLedgerConflictError);
    assert.equal((await artifact.inspect(7, 1, dispatched.requestId))?.artifactHash, first.artifactHash);
  } finally { await db.destroy(); }
});

test("a failed local media write leaves an inspectable pending intent, not a success claim", async () => {
  const db = await database();
  try {
    const { ledger } = runtimes(db);
    const dispatched = await ledger.dispatch({ projectId: 7, actorUserId: 1,
      runId: "run", approvalId: "approval", expectedVersion: 1 });
    let failWrite = true;
    let id = 0;
    const artifact = createBillableImageArtifactRuntime({
      work: async (operation) => operation(db), now: () => 101, createId: () => `pending-${++id}`,
      writeMedia: async () => { if (failWrite) throw new Error("local storage unavailable"); },
    });
    await assert.rejects(artifact.observe(dispatched.requestId, png), /local storage unavailable/);
    assert.equal((await artifact.inspect(7, 1, dispatched.requestId))?.status, "write_pending");
    await assert.rejects(artifact.observe(dispatched.requestId, otherPng), BillableImageLedgerConflictError);
    assert.equal((await db("o_agentVendorRequest").where({ requestId: dispatched.requestId }).first()).artifactHash, null);
    assert.equal((await db("o_image").where({ id: dispatched.imageId }).first()).state, "等待中");
    failWrite = false;
    assert.equal((await artifact.observe(dispatched.requestId, png)).status, "observed");
    assert.equal((await db("o_agentImageArtifact").where({ vendorRequestId: dispatched.vendorRequestId })).length, 1);
  } finally { await db.destroy(); }
});

test("late callback after cancellation persists inspectable media but cannot complete the image", async () => {
  const db = await database();
  try {
    const { ledger, artifact } = runtimes(db);
    const dispatched = await ledger.dispatch({ projectId: 7, actorUserId: 1, runId: "run", approvalId: "approval", expectedVersion: 1 });
    const run = await db("o_agentRun").where({ id: "run" }).first();
    await ledger.requestCancellation({ projectId: 7, actorUserId: 1, requestId: dispatched.requestId,
      expectedVersion: run.version });
    const late = await artifact.observe(dispatched.requestId, png);
    assert.equal(late.status, "late");
    assert.equal((await db("o_agentVendorRequest").where({ requestId: dispatched.requestId }).first()).status,
      "late_artifact_observed");
    assert.equal((await db("o_image").where({ id: dispatched.imageId }).first()).state, "已取消");
    assert.equal((await db("o_assets").where({ id: 10 }).first()).imageId, null);
  } finally { await db.destroy(); }
});

test("stopping local tracking preserves a later artifact without resurrecting the Run", async () => {
  const db = await database();
  try {
    const { ledger, artifact } = runtimes(db);
    const dispatched = await ledger.dispatch({ projectId: 7, actorUserId: 1,
      runId: "run", approvalId: "approval", expectedVersion: 1 });
    let run = await db("o_agentRun").where({ id: "run" }).first();
    await ledger.requestCancellation({ projectId: 7, actorUserId: 1,
      requestId: dispatched.requestId, expectedVersion: run.version });
    run = await db("o_agentRun").where({ id: "run" }).first();
    await assert.rejects(ledger.stopWithoutReplay({ projectId: 7, actorUserId: 2,
      requestId: dispatched.requestId, expectedVersion: run.version }), BillableImageLedgerConflictError);
    await ledger.stopWithoutReplay({ projectId: 7, actorUserId: 1,
      requestId: dispatched.requestId, expectedVersion: run.version });
    assert.equal((await db("o_agentRun").where({ id: "run" }).first()).status, "cancelled");
    assert.equal((await artifact.observe(dispatched.requestId, png)).status, "late");
    run = await db("o_agentRun").where({ id: "run" }).first();
    assert.equal(run.status, "cancelled");
    assert.deepEqual(JSON.parse(run.allowedActions), ["inspect"]);
    assert.equal((await artifact.inspect(7, 1, dispatched.requestId))?.status, "late");
    await recoverInterruptedAgentRuns(db, 200);
    assert.equal((await db("o_agentRun").where({ id: "run" }).first()).status, "cancelled");
  } finally { await db.destroy(); }
});

test("accepted artifact atomically commits Image, Asset, Receipt, Output and checkpoint", async () => {
  const db = await database();
  try {
    const { ledger, artifact, commit } = runtimes(db);
    const dispatched = await ledger.dispatch({ projectId: 7, actorUserId: 1, runId: "run", approvalId: "approval", expectedVersion: 1 });
    const observed = await artifact.observe(dispatched.requestId, png);
    const run = await db("o_agentRun").where({ id: "run" }).first();
    const accepted = await commit.commit({ projectId: 7, actorUserId: 1,
      requestId: dispatched.requestId, expectedVersion: run.version });
    assert.deepEqual(accepted, { assetId: 10, imageId: dispatched.imageId, artifactHash: observed.artifactHash });
    assert.equal((await db("o_image").where({ id: dispatched.imageId }).first()).state, "已完成");
    assert.equal((await db("o_assets").where({ id: 10 }).first()).imageId, dispatched.imageId);
    assert.equal((await db("o_agentToolReceipt").where({ id: "receipt" }).first()).status, "succeeded");
    assert.equal((await db("o_agentVendorRequest").where({ requestId: dispatched.requestId }).first()).status, "succeeded");
    assert.deepEqual((await db("o_agentRunCheckpoint").orderBy("sequence")).map((row) => row.kind),
      ["run-created", "vendor-request-intent", "step-committed"]);
    assert.deepEqual(await commit.commit({ projectId: 7, actorUserId: 1,
      requestId: dispatched.requestId, expectedVersion: run.version }), accepted);
    assert.equal((await db("o_agentRunOutput")).length, 1);
    await recoverInterruptedAgentRuns(db, 200);
    assert.equal((await db("o_agentRun").where({ id: "run" }).first()).status, "succeeded");
  } finally { await db.destroy(); }
});
