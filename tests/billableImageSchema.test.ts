import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import initDB from "../src/lib/initDB";

test("schema ensure is idempotent and creates distinct ToolCall, VendorRequest and Artifact ledgers", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await initDB(db);
    await initDB(db);
    for (const table of ["o_agentToolCall", "o_agentVendorRequest", "o_agentImageArtifact"]) {
      assert.equal(await db.schema.hasTable(table), true);
    }
    const vendorColumns = (await db("o_agentVendorRequest").columnInfo());
    for (const key of ["runId", "toolCallId", "requestId", "scopeHash", "providerTaskId", "artifactHash", "cancellationRequestedAt"]) {
      assert.ok(vendorColumns[key], `missing ${key}`);
    }
    const definitions = await db.raw(`SELECT name, sql FROM sqlite_master
      WHERE type = 'trigger' AND name IN (
        'o_agentImageArtifact_identity_immutable',
        'o_agentToolCall_identity_immutable',
        'o_agentVendorRequest_identity_immutable'
      )`);
    assert.deepEqual(definitions.map((row: { name: string }) => row.name).sort(), [
      "o_agentImageArtifact_identity_immutable", "o_agentToolCall_identity_immutable", "o_agentVendorRequest_identity_immutable",
    ]);
    const observation = await db.raw("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'o_agentVendorRequest_observation_immutable'");
    assert.equal(observation.length, 1);
  } finally {
    await db.destroy();
  }
});
