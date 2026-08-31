import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import knexFactory, { type Knex } from "knex";

import { closeDatabase, type DatabaseWork } from "../src/database";

/**
 * A pass-through `DatabaseWork` adapter over a bare Knex instance, for tests
 * that exercise the migrated Production/Workbench modules without opening the
 * full readiness lifecycle. It preserves the `work()` call shape so those
 * modules are proven against the seam rather than a raw handle.
 */
export function workOf(db: Knex): DatabaseWork {
  return async <T>(operation: (database: Knex) => Promise<T> | T): Promise<T> => operation(db);
}

/**
 * Real temporary SQLite files inside a real temporary data directory. The
 * readiness module reads the same `DATA_DIR` override the application uses, so
 * no storage seam or mocked Knex is involved.
 */
const REPOSITORY_DATA_ROOT = path.resolve(process.cwd(), "data");

export function createDataRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(path.join(REPOSITORY_DATA_ROOT, "promptProfiles"), path.join(root, "promptProfiles"), {
    recursive: true,
  });
  // The fresh-database seeder computes real Embeddings, so it needs the ONNX
  // model. Junction-linked rather than copied: it is a 45 MB read-only asset.
  fs.symlinkSync(path.join(REPOSITORY_DATA_ROOT, "models"), path.join(root, "models"), "junction");
  return root;
}

export async function withDataRoot<T>(prefix: string, operation: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = createDataRoot(prefix);
  process.env.DATA_DIR = dataRoot;
  try {
    return await operation(dataRoot);
  } finally {
    await closeDatabase().catch(() => undefined);
    delete process.env.DATA_DIR;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function openSqliteFile(databaseFile: string) {
  return knexFactory({ client: "better-sqlite3", connection: { filename: databaseFile }, useNullAsDefault: true });
}
