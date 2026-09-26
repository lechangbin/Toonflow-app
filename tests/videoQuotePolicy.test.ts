import assert from "node:assert/strict";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import { createVideoQuotePolicy, VideoQuotePolicyConflictError,
  videoQuoteScopeKey } from "../src/controlledTools/videoQuotePolicy";
import initDB from "../src/lib/initDB";
import { workOf } from "./databaseTestSupport";

const target = { projectId: 7, vendorId: "agnes", modelId: "agnes-video-v2.0",
  capabilityId: "text-to-video" as const,
  output: { presetId: "720p", duration: 5, resolution: "720p",
    aspectRatio: "16:9" as const },
  audio: { generation: "native" as const, enabled: true } };

async function database(): Promise<Knex> {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  await initDB(db);
  await db("o_project").insert([{ id: 7, userId: 1 }, { id: 8, userId: 2 }]);
  return db;
}

test("only Project Owner can set a versioned exact Video estimate", async () => {
  const db = await database();
  try {
    let next = 0;
    const policy = createVideoQuotePolicy({ work: workOf(db),
      now: () => 100, createId: () => `quote-${++next}` });
    assert.equal(await policy.get(target, 1), null);
    await assert.rejects(policy.quote(target), VideoQuotePolicyConflictError);
    await assert.rejects(policy.set({ ...target, actorUserId: 2,
      expectedRevision: 0, estimatedMaxCostMicros: 250_000, currency: "USD" }),
    VideoQuotePolicyConflictError);
    const first = await policy.set({ ...target, actorUserId: 1,
      expectedRevision: 0, estimatedMaxCostMicros: 250_000, currency: "USD" });
    assert.equal(first.revision, 1);
    assert.equal((await policy.quote(target)).estimatedMaxCostMicros, 250_000);
    assert.equal((await policy.get(target, 1))?.revision, 1);
    await assert.rejects(policy.get(target, 2), VideoQuotePolicyConflictError);
    await assert.rejects(policy.set({ ...target, actorUserId: 1,
      expectedRevision: 0, estimatedMaxCostMicros: 300_000, currency: "USD" }),
    VideoQuotePolicyConflictError);
    const revised = await policy.set({ ...target, actorUserId: 1,
      expectedRevision: 1, estimatedMaxCostMicros: 300_000, currency: "USD" });
    assert.equal(revised.revision, 2);
    assert.equal((await db("o_agentVideoQuotePolicy")).length, 1);
    await initDB(db);
    assert.equal((await policy.quote(target)).revision, 2,
      "schema reconciliation must not overwrite an Owner estimate");
  } finally { await db.destroy(); }
});

test("different duration, output or audio cannot borrow another Video estimate", async () => {
  const db = await database();
  try {
    const policy = createVideoQuotePolicy({ work: workOf(db),
      now: () => 100, createId: () => "quote-1" });
    await policy.set({ ...target, actorUserId: 1,
      expectedRevision: 0, estimatedMaxCostMicros: 250_000, currency: "USD" });
    assert.match(videoQuoteScopeKey(target), /^[a-f0-9]{64}$/);
    const otherDuration = { ...target, output: { ...target.output, duration: 6 } };
    const otherAudio = { ...target, audio: { generation: "native" as const, enabled: false } };
    const otherAspect = { ...target, output: { ...target.output,
      aspectRatio: "9:16" as const } };
    for (const selection of [otherDuration, otherAudio, otherAspect]) {
      assert.notEqual(videoQuoteScopeKey(selection), videoQuoteScopeKey(target));
      await assert.rejects(policy.quote(selection), VideoQuotePolicyConflictError);
    }
    assert.equal((await db("o_agentVideoQuotePolicy")).length, 1);
  } finally { await db.destroy(); }
});
