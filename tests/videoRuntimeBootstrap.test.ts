import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";

import { releasedVendorIds } from "../src/lib/vendorRegistry";
import { validateConfiguredVideoRuntimeData } from "../src/video/bootstrap";

test("validates each configured Vendor once against the complete runtime registry", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_vendorConfig", (table) => {
    table.string("id").primary();
    table.text("inputValues");
    table.text("models");
  });
  await db("o_vendorConfig").insert(releasedVendorIds().map((id) => ({ id, inputValues: "{}", models: "[]" })));

  try {
    const result = await validateConfiguredVideoRuntimeData(db, path.join(process.cwd(), "data"));
    assert.deepEqual(result.vendorIds.sort(), releasedVendorIds().slice().sort());
    assert.equal(result.videoModelCount, 8);
    assert.equal(result.promptProfileCount, 8);
  } finally {
    await db.destroy();
  }
});
