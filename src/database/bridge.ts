import type { Knex } from "knex";

/**
 * Temporary migration bridge for the ~130 legacy `u.db(...)` call sites that
 * still reach for a raw Knex handle. It holds no readiness rules: it only
 * publishes the handle `src/database/index.ts` opened, so unchanged callers keep
 * working until #16/#17 route them through `DatabaseRuntime.work`.
 *
 * The handle goes live as soon as the readiness module opens the connection,
 * because readiness phases themselves still reach for the global handle (the
 * fresh-database skill seeder does). It is withdrawn whenever opening fails or
 * the runtime closes, so no caller can use it outside an open runtime.
 *
 * Delete this module together with the raw exports in `src/utils/db.ts` once no
 * business caller needs a synchronous handle.
 */
let activatedHandle: Knex | undefined;

export function activateLegacyDatabaseHandle(handle: Knex): void {
  activatedHandle = handle;
}

export function clearLegacyDatabaseHandle(): void {
  activatedHandle = undefined;
}

export function isLegacyDatabaseHandleReady(): boolean {
  return activatedHandle !== undefined;
}

export function resolveLegacyDatabaseHandle(): Knex {
  if (!activatedHandle) {
    throw new Error(
      "数据库尚未就绪：读取全局数据库句柄前请先 await openDatabase()。数据库就绪模块不再在模块导入时打开文件，请检查启动路径是否已跨过 openDatabase()。",
    );
  }
  return activatedHandle;
}
