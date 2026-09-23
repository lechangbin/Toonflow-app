import assert from "node:assert/strict";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import { createBillableImageApprovalRuntime } from "../src/controlledTools/billableImageApproval";
import { createBillableImageLedger, BillableImageLedgerConflictError } from "../src/controlledTools/billableImageLedger";
import initDB from "../src/lib/initDB";

const target = { projectId: 7, assetId: 10, vendorId: "vendor", modelId: "model", resolution: "1024x1024" };
const proposal = { ...target, actorUserId: 1, clientRequestId: "client-1", operationId: "operation-1" };
const stableHash = "a".repeat(64);

async function database(): Promise<Knex> {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await initDB(db);
  await db("o_project").insert({ id: 7, userId: 1 });
  await db("o_assets").insert({ id: 10, projectId: 7, type: "role", name: "Asset" });
  return db;
}

function runtimes(db: Knex, options: { now?: () => number; stateHash?: () => string; quoteMicros?: number } = {}) {
  let next = 0;
  const now = options.now ?? (() => 100);
  const stateHash = options.stateHash ?? (() => stableHash);
  const work = async <T>(operation: (db: Knex) => Promise<T> | T) => operation(db);
  const preflight = async (tx: Knex.Transaction, scope: typeof target & { estimatedMaxCostMicros: number; currency: string }) => {
    const asset = await tx("o_assets").where({ id: scope.assetId, projectId: scope.projectId }).first();
    if (!asset) throw new Error("asset not available");
    return { targetStateHash: stateHash(), preview: { assetId: scope.assetId, assetName: asset.name,
      vendorId: scope.vendorId, modelId: scope.modelId, resolution: scope.resolution,
      estimatedMaxCostMicros: scope.estimatedMaxCostMicros, currency: scope.currency,
      disclaimer: "估计费用并非最终账单" } };
  };
  const approval = createBillableImageApprovalRuntime({ work, now, createId: () => `id-${++next}`,
    quote: async () => ({ estimatedMaxCostMicros: options.quoteMicros ?? 200_000, currency: "USD" }),
    preflight, approvalTtlMs: 1000 });
  const ledger = createBillableImageLedger({ work, now, createId: () => `dispatch-${++next}`,
    verifyPreflight: async (tx, scope) => (await preflight(tx, scope)).targetStateHash });
  return { approval, ledger };
}

test("server quote and frozen target state bind one approved dispatch; duplicate commands never grant another", async () => {
  const db = await database();
  try {
    const { approval, ledger } = runtimes(db);
    const pending = await approval.propose(proposal);
    assert.equal(pending.status, "pending");
    assert.equal(pending.preview.estimatedMaxCostMicros, 200_000);
    assert.deepEqual(pending.allowedActions, ["inspect", "approve", "reject"]);
    assert.deepEqual(await approval.propose(proposal), pending);
    assert.deepEqual(await runtimes(db, { quoteMicros: 999_000 }).approval.propose(proposal), pending,
      "an existing proposal remains inspectable after the server quote policy changes");
    assert.equal((await db("o_agentToolApproval")).length, 1);
    const decision = { projectId: 7, actorUserId: 1, runId: pending.runId, approvalId: pending.id,
      clientCommandId: "command-1", expectedVersion: pending.runVersion, decision: "approve" as const };
    const approved = await approval.decide(decision);
    assert.equal(approved?.status, "approved");
    assert.deepEqual(approved?.allowedActions, ["inspect", "dispatch", "cancel"]);
    assert.deepEqual(await approval.decide(decision), approved);
    const sent = await ledger.dispatch({ projectId: 7, actorUserId: 1, runId: pending.runId,
      approvalId: pending.id, expectedVersion: approved!.runVersion });
    assert.equal(sent.maySubmit, true);
    assert.equal((await ledger.dispatch({ projectId: 7, actorUserId: 1, runId: pending.runId,
      approvalId: pending.id, expectedVersion: approved!.runVersion })).maySubmit, false);
    assert.equal((await db("o_agentVendorRequest")).length, 1);
    assert.equal((await db("o_agentRunCheckpoint")).length, 2);
  } finally { await db.destroy(); }
});

test("cross-Project actor, changed scope, stale state and expired approval fail before VendorRequest", async () => {
  const db = await database();
  let currentHash = stableHash;
  let currentTime = 100;
  try {
    const { approval, ledger } = runtimes(db, { now: () => currentTime, stateHash: () => currentHash });
    await assert.rejects(approval.propose({ ...proposal, actorUserId: 2 }), BillableImageLedgerConflictError);
    const pending = await approval.propose(proposal);
    await assert.rejects(approval.propose({ ...proposal, resolution: "512x512" }), BillableImageLedgerConflictError);
    await assert.rejects(approval.inspect(7, pending.runId, 2), BillableImageLedgerConflictError);
    currentHash = "b".repeat(64);
    const decide = { projectId: 7, actorUserId: 1, runId: pending.runId, approvalId: pending.id,
      clientCommandId: "command-1", expectedVersion: pending.runVersion, decision: "approve" as const };
    await assert.rejects(approval.decide(decide), BillableImageLedgerConflictError);
    assert.equal((await db("o_agentToolApproval").where({ id: pending.id }).first()).status, "pending");
    currentHash = stableHash;
    currentTime = 1100;
    await assert.rejects(approval.decide(decide), BillableImageLedgerConflictError);
    assert.equal((await db("o_agentToolApproval").where({ id: pending.id }).first()).status, "expired");
    assert.deepEqual((await approval.inspect(7, pending.runId, 1))?.allowedActions, ["inspect"]);
    await assert.rejects(ledger.dispatch({ projectId: 7, actorUserId: 1,
      runId: pending.runId, approvalId: pending.id, expectedVersion: pending.runVersion }), BillableImageLedgerConflictError);
    assert.equal((await db("o_agentVendorRequest")).length, 0);
  } finally { await db.destroy(); }
});

test("rejection and unavailable server quote leave no dispatch authority", async () => {
  const db = await database();
  try {
    const invalid = runtimes(db, { quoteMicros: 0 });
    await assert.rejects(invalid.approval.propose(proposal), BillableImageLedgerConflictError);
    assert.equal((await db("o_agentRun")).length, 0);
    const { approval, ledger } = runtimes(db);
    const pending = await approval.propose(proposal);
    const rejected = await approval.decide({ projectId: 7, actorUserId: 1, runId: pending.runId,
      approvalId: pending.id, clientCommandId: "reject-1", expectedVersion: pending.runVersion, decision: "reject" });
    assert.equal(rejected?.status, "rejected");
    assert.equal(rejected?.runStatus, "cancelled");
    await assert.rejects(ledger.dispatch({ projectId: 7, actorUserId: 1,
      runId: pending.runId, approvalId: pending.id, expectedVersion: rejected!.runVersion }), BillableImageLedgerConflictError);
    assert.equal((await db("o_agentToolCall")).length, 0);
  } finally { await db.destroy(); }
});
