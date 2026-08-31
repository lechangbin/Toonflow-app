import type { Knex } from "knex";

import initDB from "@/lib/initDB";

/**
 * A maintenance command that was rejected before any mutation. Routes map this
 * to the client-error response that matches the existing contract (400), while
 * every other failure maps to the server-error path (500).
 */
export class MaintenanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaintenanceValidationError";
  }
}

/**
 * Typed maintenance intents. Callers cannot supply arbitrary SQL or lifecycle
 * callbacks: they select one command from this union and the registry owns the
 * implementation.
 *
 * The exclusive runner reruns the whole readiness lifecycle after every handler
 * and reopens access only when validation passes, so a handler only has to
 * mutate. Destructive handlers (`import`, `reset`, `clearTable`) preflight their
 * input before touching the live database, mutate inside a transaction, and
 * leave the foreign-key pragma for the runner's revalidation to observe.
 */
export interface VerifyMaintenanceCommand {
  readonly kind: "verify";
}

/**
 * Import replaces the whole database with a backup payload. The payload is the
 * untrusted body of the existing `/importData` route and is validated (and
 * narrowed) by the handler's preflight, so a malformed, unknown, or unsupported
 * backup is rejected before the live database is modified.
 */
export interface ImportMaintenanceCommand {
  readonly kind: "import";
  readonly tables: unknown;
}

/** Full reset: drop every user table and reinitialise the current schema. */
export interface ResetMaintenanceCommand {
  readonly kind: "reset";
}

/** Clear one table: remove every row while leaving the schema intact. */
export interface ClearTableMaintenanceCommand {
  readonly kind: "clearTable";
  readonly tableName: string;
}

export type MaintenanceCommand =
  | VerifyMaintenanceCommand
  | ImportMaintenanceCommand
  | ResetMaintenanceCommand
  | ClearTableMaintenanceCommand;

export type MaintenanceCommandKind = MaintenanceCommand["kind"];

export interface VerifyMaintenanceResult {
  readonly kind: "verify";
  readonly verified: true;
}

export interface ImportMaintenanceResult {
  readonly kind: "import";
  readonly imported: true;
  readonly tableCount: number;
}

export interface ResetMaintenanceResult {
  readonly kind: "reset";
  readonly reset: true;
}

export interface ClearTableMaintenanceResult {
  readonly kind: "clearTable";
  readonly clearedTable: string;
}

export type MaintenanceResult =
  | VerifyMaintenanceResult
  | ImportMaintenanceResult
  | ResetMaintenanceResult
  | ClearTableMaintenanceResult;

export type MaintenanceResultFor<TCommand extends MaintenanceCommand> = TCommand extends VerifyMaintenanceCommand
  ? VerifyMaintenanceResult
  : TCommand extends ImportMaintenanceCommand
    ? ImportMaintenanceResult
    : TCommand extends ResetMaintenanceCommand
      ? ResetMaintenanceResult
      : TCommand extends ClearTableMaintenanceCommand
        ? ClearTableMaintenanceResult
        : never;

export interface MaintenanceContext {
  readonly knex: Knex;
  readonly dataRoot: string;
}

export type MaintenanceHandler<TCommand extends MaintenanceCommand> = (
  context: MaintenanceContext,
  command: TCommand,
) => Promise<MaintenanceResultFor<TCommand>>;

export type MaintenanceRegistry = {
  readonly [TCommand in MaintenanceCommand as TCommand["kind"]]: MaintenanceHandler<TCommand>;
};

/** A backup narrowed by preflight: every table maps to an array of plain rows. */
type ValidatedBackup = Record<string, Record<string, unknown>[]>;

const IMPORT_BATCH_SIZE = 100;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read-only list of the user tables currently present in the live database. */
async function listUserTables(knex: Knex): Promise<string[]> {
  const rows = (await knex.raw(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%'`,
  )) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

/**
 * Preflight for `import`: rejects a malformed, unknown, or unsupported payload
 * without touching the live database.
 */
function validateImportPayload(tables: unknown, knownTables: ReadonlySet<string>): ValidatedBackup {
  if (!isPlainObject(tables)) {
    throw new MaintenanceValidationError("无效的导入数据格式");
  }
  const validated: ValidatedBackup = {};
  for (const [tableName, rows] of Object.entries(tables)) {
    if (!knownTables.has(tableName)) {
      throw new MaintenanceValidationError(`未知的表: ${tableName}`);
    }
    if (!Array.isArray(rows)) {
      throw new MaintenanceValidationError("备份数据格式不受支持");
    }
    const cleanRows: Record<string, unknown>[] = [];
    for (const row of rows) {
      if (!isPlainObject(row)) {
        throw new MaintenanceValidationError("备份数据格式不受支持");
      }
      cleanRows.push(row);
    }
    validated[tableName] = cleanRows;
  }
  return validated;
}

/** Drops every user table and reinitialises the current schema. */
async function rebuildDatabase(db: Knex): Promise<void> {
  const existingTables = await listUserTables(db);
  for (const tableName of existingTables) {
    await db.schema.dropTableIfExists(tableName);
  }
  await initDB(db);
}

/**
 * Imports rows into the freshly reinitialised schema. Legacy backups may carry
 * columns the current schema dropped, so each row is filtered to the columns
 * that exist after `initDB`; the readiness rerun then reconciles defaults and
 * the remaining upgrade path exactly as it would at startup.
 */
async function insertBackupRows(db: Knex, backup: ValidatedBackup): Promise<void> {
  for (const [tableName, rows] of Object.entries(backup)) {
    const columns = new Set(Object.keys(await db(tableName).columnInfo()));
    const cleanedRows = rows.map((row) => {
      const cleaned: Record<string, unknown> = {};
      for (const [column, value] of Object.entries(row)) {
        if (columns.has(column)) cleaned[column] = value;
      }
      return cleaned;
    });
    await db(tableName).delete();
    for (let i = 0; i < cleanedRows.length; i += IMPORT_BATCH_SIZE) {
      await db(tableName).insert(cleanedRows.slice(i, i + IMPORT_BATCH_SIZE));
    }
  }
}

export const maintenanceRegistry: MaintenanceRegistry = {
  // `verify` performs no mutation. Its value is that the exclusive runner
  // reruns the full readiness lifecycle while every ordinary lease is parked.
  verify: async () => ({ kind: "verify", verified: true }),

  import: async (context, command) => {
    const knownTables = new Set(await listUserTables(context.knex));
    const backup = validateImportPayload(command.tables, knownTables);

    // `enforceForeignCheck: false` disables the foreign-key pragma for the
    // destructive rebuild and restores its prior value in a `finally`, on both
    // the success and the rollback path.
    await context.knex.transaction(
      async (trx) => {
        await rebuildDatabase(trx);
        await insertBackupRows(trx, backup);
      },
      { enforceForeignCheck: false },
    );

    return { kind: "import", imported: true, tableCount: Object.keys(backup).length };
  },

  reset: async (context) => {
    await context.knex.transaction(
      async (trx) => {
        await rebuildDatabase(trx);
      },
      { enforceForeignCheck: false },
    );
    return { kind: "reset", reset: true };
  },

  clearTable: async (context, command) => {
    const { tableName } = command;
    if (!tableName || typeof tableName !== "string") {
      throw new MaintenanceValidationError("请提供有效的表名");
    }
    if (tableName.startsWith("sqlite_") || tableName.startsWith("knex_")) {
      throw new MaintenanceValidationError("表不存在");
    }
    const exists = await context.knex.schema.hasTable(tableName);
    if (!exists) {
      throw new MaintenanceValidationError("表不存在");
    }
    await context.knex(tableName).delete();
    return { kind: "clearTable", clearedTable: tableName };
  },
};

export function resolveMaintenanceHandler<TCommand extends MaintenanceCommand>(
  command: TCommand,
): MaintenanceHandler<TCommand> {
  return maintenanceRegistry[command.kind] as MaintenanceHandler<TCommand>;
}
