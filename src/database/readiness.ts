import fs from "node:fs";
import path from "node:path";

import knexFactory, { type Knex } from "knex";
import { v4 as uuid } from "uuid";

import initDB from "@/lib/initDB";
import fixDB from "@/lib/fixDB";
import getPath from "@/utils/getPath";
import { validateConfiguredVendors } from "@/vendor/startup";
import { validateConfiguredVideoRuntimeData } from "@/video/bootstrap";
import { failInterruptedVideoProduction } from "@/video/recovery";

import { generateDatabaseTypes } from "./developmentTypes";

export const DEFAULT_DATABASE_FILE_NAME = "db2.sqlite";

/**
 * SQLite waits instead of failing immediately when another connection holds a
 * write lock. The readiness module serialises its own work, but the process
 * still shares the file with anything else that opens it.
 */
const CONNECTION_BUSY_TIMEOUT_MS = 5000;

export type ReadinessPhaseName =
  | "ensureSchema"
  | "applyUpgrades"
  | "reconcileDefaults"
  | "recoverInterruptedWork"
  | "validate";

export interface ReadinessContext {
  readonly knex: Knex;
  readonly dataRoot: string;
  readonly databaseFile: string;
}

export interface OpenResourcesOptions {
  readonly dataRoot?: string;
  readonly databaseFileName?: string;
}

/** A setting the application cannot serve requests without. */
interface RequiredSettingDefault {
  readonly key: string;
  readonly createValue: () => string;
}

/**
 * `initDB` seeds these only while creating `o_setting`, so a database created
 * before a key existed never receives it from the upgrade path. The readiness
 * lifecycle owns the invariant instead of trusting either script.
 */
const REQUIRED_SETTING_DEFAULTS: readonly RequiredSettingDefault[] = [
  { key: "tokenKey", createValue: () => uuid().slice(0, 8) },
];

export class ReadinessPhaseError extends Error {
  readonly phase: ReadinessPhaseName;

  constructor(phase: ReadinessPhaseName, cause: unknown) {
    super(`数据库就绪阶段 ${phase} 失败: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ReadinessPhaseError";
    this.phase = phase;
    this.cause = cause;
  }
}

/**
 * Phase 1: open local resources. Ensures the data directory and database file
 * exist, opens the connection, and applies the connection PRAGMAs.
 */
export async function openResources(options: OpenResourcesOptions = {}): Promise<ReadinessContext> {
  const databaseFile = getPath(options.databaseFileName ?? DEFAULT_DATABASE_FILE_NAME);
  const dataRoot = options.dataRoot ?? getPath();

  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  if (!fs.existsSync(databaseFile)) fs.writeFileSync(databaseFile, "");

  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: databaseFile },
    useNullAsDefault: true,
  });
  await knex.raw(`PRAGMA busy_timeout = ${CONNECTION_BUSY_TIMEOUT_MS}`);

  return { knex, dataRoot, databaseFile };
}

/** Phase 2: ensure the database carries the current schema. */
export async function ensureSchema(context: ReadinessContext): Promise<void> {
  await initDB(context.knex);
}

/** Phase 3: apply the known upgrade path. */
export async function applyUpgrades(context: ReadinessContext): Promise<void> {
  await fixDB(context.knex, context.dataRoot);
}

/** Phase 4: reconcile the defaults the application requires to serve work. */
export async function reconcileDefaults(context: ReadinessContext): Promise<void> {
  for (const setting of REQUIRED_SETTING_DEFAULTS) {
    const existing = await context.knex("o_setting").where("key", setting.key).first();
    if (existing) continue;
    await context.knex("o_setting").insert({ key: setting.key, value: setting.createValue() });
  }
}

/** Phase 5: recover work an interrupted process left mid-flight. */
export async function recoverInterruptedWork(context: ReadinessContext): Promise<void> {
  await failInterruptedVideoProduction(context.knex);
}

/** Phase 6: validate the database and the required runtime invariants. */
export async function validateDatabase(context: ReadinessContext): Promise<void> {
  await validateConfiguredVendors(context.knex, context.dataRoot);
  await validateConfiguredVideoRuntimeData(context.knex, context.dataRoot);
}

/**
 * The only readiness order. `openResources` runs once before the runtime exists;
 * every later entry point — opening, and each maintenance revalidation — replays
 * this exact sequence.
 */
const READINESS_PHASES: readonly {
  readonly name: ReadinessPhaseName;
  readonly run: (context: ReadinessContext) => Promise<void>;
}[] = [
  { name: "ensureSchema", run: ensureSchema },
  { name: "applyUpgrades", run: applyUpgrades },
  { name: "reconcileDefaults", run: reconcileDefaults },
  { name: "recoverInterruptedWork", run: recoverInterruptedWork },
  { name: "validate", run: validateDatabase },
];

export async function runReadiness(context: ReadinessContext): Promise<void> {
  for (const phase of READINESS_PHASES) {
    try {
      await phase.run(context);
    } catch (error) {
      throw new ReadinessPhaseError(phase.name, error);
    }
  }
}

/**
 * Phase 7: development-only database type generation. A derived development
 * artifact is never a readiness invariant, so every failure is logged and
 * swallowed rather than allowed to stop startup.
 */
export async function runDevelopmentPhase(context: ReadinessContext): Promise<void> {
  if (process.env.NODE_ENV !== "dev") return;
  try {
    await generateDatabaseTypes(context.knex);
  } catch (error) {
    console.error("[数据库类型生成失败，已忽略]", error);
  }
}
