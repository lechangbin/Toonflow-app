import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { Knex } from "knex";
import knexFactory from "knex";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Caller must serialize all Runtime work while this in-memory database is checkpointed. */
export async function writeSanitizedRuntimeCorpusCheckpoint(input: {
  db: Knex; directory: string; sequence: number; secretValues: string[];
}): Promise<{ path: string; sha256: string; bytes: number }> {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0
    || input.secretValues.length === 0
    || input.secretValues.some((value) => !value || value.length < 8)) {
    throw new TypeError("Runtime checkpoint sequence or secret guard is invalid");
  }
  const directory = path.resolve(input.directory);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const basename = `checkpoint-${String(input.sequence).padStart(4, "0")}.sqlite`;
  const target = path.join(directory, basename);
  const temporary = path.join(directory, `${basename}.pending`);
  const originals = await input.db("o_vendorConfig").select("id", "inputValues");
  let pendingCreated = false;
  try {
    await input.db("o_vendorConfig").update({ inputValues: "{}" });
    // Rebuild pages after removing credentials; SQLite serialization otherwise retains freelist bytes.
    await input.db.raw("VACUUM");
    const connection = await input.db.client.acquireConnection();
    let snapshot: Buffer;
    try {
      if (typeof connection.serialize !== "function") {
        throw new TypeError("Runtime checkpoint requires a better-sqlite3 connection");
      }
      snapshot = connection.serialize() as Buffer;
    } finally { await input.db.client.releaseConnection(connection); }
    if (input.secretValues.some((value) => snapshot.includes(Buffer.from(value, "utf8")))) {
      throw new Error("Runtime checkpoint still contains a guarded secret");
    }
    const handle = await fs.open(temporary, "wx", 0o600);
    pendingCreated = true;
    try { await handle.writeFile(snapshot); await handle.sync(); }
    finally { await handle.close(); }
    // A hard link publishes the synced bytes without rename's overwrite-on-Windows race.
    try { await fs.link(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("Runtime checkpoint already exists");
      }
      throw error;
    }
    await fs.unlink(temporary);
    pendingCreated = false;
    return { path: target, sha256: digest(snapshot), bytes: snapshot.length };
  } finally {
    if (pendingCreated) await fs.rm(temporary, { force: true });
    for (const row of originals) {
      await input.db("o_vendorConfig").where({ id: row.id })
        .update({ inputValues: row.inputValues });
    }
  }
}

/** Reopens a redacted snapshot as an isolated in-memory database; credentials are re-injected by the caller. */
export async function openSanitizedRuntimeCorpusCheckpoint(file: string): Promise<{
  db: Knex; sha256: string;
}> {
  const bytes = await fs.readFile(path.resolve(file));
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: bytes as unknown as string }, useNullAsDefault: true,
    pool: { min: 1, max: 1 } });
  try {
    const integrity = await db.raw("PRAGMA integrity_check");
    if (integrity?.[0]?.integrity_check !== "ok"
      || (await db("o_vendorConfig").select("inputValues"))
        .some((row) => row.inputValues !== "{}")) {
      throw new Error("Runtime checkpoint is corrupt or contains Vendor configuration");
    }
    return { db, sha256: digest(bytes) };
  } catch (error) {
    await db.destroy();
    throw error;
  }
}
