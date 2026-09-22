import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import {
  AgentRunLeaseLostError,
  assertAgentRunLease,
  claimAgentRunLease,
  renewAgentRunLease,
} from "../src/agentRuntime/lease";

async function createLeaseDatabase() {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_agentRun", (table) => {
    table.text("id").primary();
    table.text("status").notNullable();
    table.text("attentionReason");
    table.integer("cancellationRequestedAt");
    table.integer("version").notNullable();
    table.integer("updatedAt").notNullable();
    table.text("leaseOwnerId");
    table.text("leaseEpoch");
    table.integer("leaseExpiresAt");
    table.integer("fence").notNullable().defaultTo(0);
  });
  await db("o_agentRun").insert({ id: "run-1", status: "queued", version: 1, updatedAt: 100 });
  return db;
}

test("one worker owns a queued Run and repeated claim by the same epoch is idempotent", async () => {
  const db = await createLeaseDatabase();
  try {
    const first = await claimAgentRunLease(db, { runId: "run-1", ownerId: "worker-a", epoch: "epoch-a", now: 100, durationMs: 60 });
    assert.deepEqual(first, { runId: "run-1", ownerId: "worker-a", epoch: "epoch-a", fence: 1, expiresAt: 160 });
    const duplicate = await claimAgentRunLease(db, { runId: "run-1", ownerId: "worker-a", epoch: "epoch-a", now: 110, durationMs: 60 });
    assert.deepEqual(duplicate, first);
    assert.equal(await claimAgentRunLease(db, { runId: "run-1", ownerId: "worker-b", epoch: "epoch-b", now: 110, durationMs: 60 }), null);
    assert.equal((await db("o_agentRun").first()).version, 2);
  } finally {
    await db.destroy();
  }
});

test("expiry allows a higher fence and rejects every stale renewal or worker write", async () => {
  const db = await createLeaseDatabase();
  try {
    const oldLease = (await claimAgentRunLease(db, { runId: "run-1", ownerId: "worker-a", epoch: "epoch-a", now: 100, durationMs: 60 }))!;
    const newLease = (await claimAgentRunLease(db, { runId: "run-1", ownerId: "worker-b", epoch: "epoch-b", now: 160, durationMs: 60 }))!;
    assert.equal(newLease.fence, oldLease.fence + 1);
    await assert.rejects(renewAgentRunLease(db, oldLease, 161, 60), AgentRunLeaseLostError);
    await assert.rejects(db.transaction((trx) => assertAgentRunLease(trx, oldLease, 161)), AgentRunLeaseLostError);
    await db.transaction((trx) => assertAgentRunLease(trx, newLease, 161));
    const renewed = await renewAgentRunLease(db, newLease, 180, 60);
    assert.equal(renewed.expiresAt, 240);
    assert.equal((await db("o_agentRun").first()).version, 3, "heartbeat does not advance lifecycle revision");
  } finally {
    await db.destroy();
  }
});

test("attention, cancellation intent, and terminal status cannot acquire a worker lease", async () => {
  const db = await createLeaseDatabase();
  try {
    const claim = () => claimAgentRunLease(db, { runId: "run-1", ownerId: "worker-a", epoch: "epoch-a", now: 100, durationMs: 60 });
    await db("o_agentRun").update({ attentionReason: "reconcile-first" });
    assert.equal(await claim(), null);
    await db("o_agentRun").update({ attentionReason: null, cancellationRequestedAt: 100 });
    assert.equal(await claim(), null);
    await db("o_agentRun").update({ cancellationRequestedAt: null, status: "succeeded" });
    assert.equal(await claim(), null);
  } finally {
    await db.destroy();
  }
});
