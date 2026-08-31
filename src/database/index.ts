import type { Knex } from "knex";

import { DatabaseAccess, DatabaseNotOpenError, DatabaseUnavailableError, type DatabaseRuntimeState } from "./access";
import type { MaintenanceCommand, MaintenanceResultFor } from "./maintenance";
import { openResources, type OpenResourcesOptions, type ReadinessContext } from "./readiness";

export type { DatabaseRuntimeState } from "./access";
export { DatabaseNotOpenError, DatabaseUnavailableError } from "./access";
export { MaintenanceValidationError } from "./maintenance";
export type {
  ClearTableMaintenanceCommand,
  ClearTableMaintenanceResult,
  ImportMaintenanceCommand,
  ImportMaintenanceResult,
  MaintenanceCommand,
  MaintenanceCommandKind,
  MaintenanceResult,
  MaintenanceResultFor,
  ResetMaintenanceCommand,
  ResetMaintenanceResult,
  VerifyMaintenanceCommand,
  VerifyMaintenanceResult,
} from "./maintenance";

/**
 * A shared lease on the open database: the operation receives a Knex instance
 * and the lease is released only when the operation settles. Migrated callers
 * depend on this shape instead of a raw `Knex` handle, so their database access
 * cannot bypass readiness.
 */
export type DatabaseWork = <T>(operation: (db: Knex) => Promise<T> | T) => Promise<T>;

/**
 * The single database readiness interface. Ordinary work borrows a shared lease
 * on a Knex instance handed into the callback; maintenance takes exclusive,
 * writer-preferred access. No raw handle is exposed, so no caller can bypass
 * readiness.
 */
export interface DatabaseRuntime {
  work: DatabaseWork;
  maintenance<TCommand extends MaintenanceCommand>(command: TCommand): Promise<MaintenanceResultFor<TCommand>>;
  close(): Promise<void>;
  readonly state: DatabaseRuntimeState;
}

export type OpenDatabaseOptions = OpenResourcesOptions;

let opening: Promise<DatabaseRuntime> | undefined;
let active: DatabaseRuntime | undefined;

/** Opens the database and resolves only after the fixed readiness lifecycle succeeds. Single-flight. */
export function openDatabase(options: OpenDatabaseOptions = {}): Promise<DatabaseRuntime> {
  if (active) return Promise.resolve(active);
  if (opening) return opening;
  opening = startOpening(options);
  return opening;
}

/** Returns the active runtime. Throws when opening has not succeeded yet. */
export function getDatabaseRuntime(): DatabaseRuntime {
  if (!active) throw new DatabaseNotOpenError();
  return active;
}

/** Closes the active runtime and forgets it, so a later `openDatabase()` reopens from scratch. */
export async function closeDatabase(): Promise<void> {
  if (!active && opening) await opening.catch(() => undefined);
  const runtime = active;
  active = undefined;
  if (runtime) await runtime.close();
}

async function startOpening(options: OpenDatabaseOptions): Promise<DatabaseRuntime> {
  let context: ReadinessContext | undefined;
  try {
    context = await openResources(options);
    const runtime = createRuntime(new DatabaseAccess(context));
    await runtime.start();
    active = runtime;
    return runtime;
  } catch (error) {
    if (context) await context.knex.destroy().catch(() => undefined);
    throw error;
  } finally {
    opening = undefined;
  }
}

interface InternalDatabaseRuntime extends DatabaseRuntime {
  start(): Promise<void>;
}

function createRuntime(access: DatabaseAccess): InternalDatabaseRuntime {
  const runtime: InternalDatabaseRuntime = {
    start: () => access.start(),
    work: (operation) => access.work(operation),
    maintenance: <TCommand extends MaintenanceCommand>(command: TCommand) => access.maintenance(command),
    close: async () => {
      if (active === runtime) active = undefined;
      await access.close();
    },
    get state() {
      return access.state;
    },
  };
  return runtime;
}
