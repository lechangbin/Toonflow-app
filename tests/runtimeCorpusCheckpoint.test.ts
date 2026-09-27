import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory from "knex";

import { openSanitizedRuntimeCorpusCheckpoint,
  writeSanitizedRuntimeCorpusCheckpoint } from "../src/eval/runtimeCorpusCheckpoint";
import initDB from "../src/lib/initDB";

test("T11 checkpoint persists evidence but never serializes the live Vendor key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "toonflow-runtime-checkpoint-"));
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true,
    pool: { min: 1, max: 1 } });
  const secret = "sk-test-checkpoint-secret-should-never-appear";
  let reopened: ReturnType<typeof knexFactory> | null = null;
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_vendorConfig").where({ id: "agnes" })
      .update({ inputValues: JSON.stringify({ apiKey: secret }) });
    await db("o_project").insert({ id: 7, userId: 1, name: "checkpoint fixture" });
    const saved = await writeSanitizedRuntimeCorpusCheckpoint({ db, directory,
      sequence: 1, secretValues: [secret] });
    assert.equal((await db("o_vendorConfig").where({ id: "agnes" }).first())!.inputValues,
      JSON.stringify({ apiKey: secret }));
    const bytes = await fs.readFile(saved.path);
    assert.equal(bytes.includes(Buffer.from(secret)), false);
    const loaded = await openSanitizedRuntimeCorpusCheckpoint(saved.path);
    reopened = loaded.db;
    assert.equal(loaded.sha256, saved.sha256);
    assert.equal((await reopened("o_project").where({ id: 7 }).first())!.name,
      "checkpoint fixture");
    assert.equal((await reopened("o_vendorConfig").where({ id: "agnes" }).first())!.inputValues,
      "{}");
    await assert.rejects(writeSanitizedRuntimeCorpusCheckpoint({ db, directory,
      sequence: 2, secretValues: [] }), /secret guard/u);
    await assert.rejects(writeSanitizedRuntimeCorpusCheckpoint({ db, directory,
      sequence: 1, secretValues: [secret] }), /already exists/u);
  } finally {
    if (reopened) await reopened.destroy();
    await db.destroy();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("T11 concurrent publishers cannot overwrite the same checkpoint sequence", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "toonflow-runtime-publish-"));
  const databases = [0, 1].map(() => knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true,
    pool: { min: 1, max: 1 } }));
  const secret = "sk-test-concurrent-secret";
  try {
    for (const db of databases) {
      await db.raw("PRAGMA foreign_keys = OFF");
      await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
      const originalLog = console.log;
      console.log = () => undefined;
      try { await initDB(db); } finally { console.log = originalLog; }
      await db("o_vendorConfig").where({ id: "agnes" })
        .update({ inputValues: JSON.stringify({ apiKey: secret }) });
    }
    const results = await Promise.allSettled(databases.map((db) =>
      writeSanitizedRuntimeCorpusCheckpoint({ db, directory, sequence: 0,
        secretValues: [secret] })));
    const succeeded = results.filter((result) => result.status === "fulfilled");
    assert.equal(succeeded.length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const target = path.join(directory, "checkpoint-0000.sqlite");
    const bytes = await fs.readFile(target);
    assert.equal(bytes.includes(Buffer.from(secret)), false);
    assert.equal((await fs.readdir(directory)).filter((name) => name.endsWith(".pending")).length, 0);
  } finally {
    await Promise.all(databases.map((db) => db.destroy()));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
