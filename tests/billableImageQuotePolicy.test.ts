import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createBillableImageQuotePolicy } from "../src/controlledTools/billableImageQuotePolicy";
import { BillableImageLedgerConflictError } from "../src/controlledTools/billableImageLedger";
import initDB from "../src/lib/initDB";

const target = { projectId: 7, vendorId: "vendor", modelId: "model", resolution: "1K" };

test("missing quote fails closed; only Project owner can set versioned local estimate", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await initDB(db);
    await db("o_project").insert({ id: 7, userId: 1 });
    let id = 0;
    const policy = createBillableImageQuotePolicy({ work: async (operation) => operation(db),
      now: () => 100, createId: () => `id-${++id}` });
    assert.equal(await policy.get(target, 1), null);
    await assert.rejects(policy.quote({ ...target, assetId: 10 }), BillableImageLedgerConflictError);
    await assert.rejects(policy.get(target, 2), BillableImageLedgerConflictError);
    const input = { ...target, actorUserId: 1, expectedRevision: 0,
      estimatedMaxCostMicros: 200_000, currency: "USD" };
    await assert.rejects(policy.set({ ...input, actorUserId: 2 }), BillableImageLedgerConflictError);
    const initial = await policy.set(input);
    assert.equal(initial.revision, 1);
    assert.deepEqual(await policy.quote({ ...target, assetId: 10 }), { estimatedMaxCostMicros: 200_000, currency: "USD" });
    await assert.rejects(policy.set(input), BillableImageLedgerConflictError);
    const revised = await policy.set({ ...input, expectedRevision: 1, estimatedMaxCostMicros: 300_000 });
    assert.equal(revised.revision, 2);
    assert.equal((await policy.get(target, 1))?.estimatedMaxCostMicros, 300_000);
  } finally { await db.destroy(); }
});
