import type { Knex } from "knex";

import { openDatabase } from "@/database";
import { resolveLegacyDatabaseHandle } from "@/database/bridge";
import type { DB } from "@/types/database";

type TableName = keyof DB & string;
type RowType<TName extends TableName> = DB[TName];

type DatabaseClient = Knex & {
  <TName extends TableName>(table: TName): Knex.QueryBuilder<RowType<TName>, RowType<TName>[]>;
};

/**
 * Legacy bridge for the ~130 `u.db(...)` call sites (#16/#17 migrate them).
 *
 * This module performs no filesystem or database work at import time. Every
 * access resolves the handle the readiness module activated, so importing this
 * file is free and using the handle before `openDatabase()` succeeded throws an
 * actionable error instead of silently touching a half-initialised database.
 */
function lazyHandle<T extends object>(resolve: () => T): T {
  return new Proxy(function () {} as unknown as T, {
    apply: (_target, _thisArg, args) => (resolve() as unknown as (...args: unknown[]) => unknown)(...args),
    get: (_target, property) => {
      const handle = resolve() as unknown as Record<string | symbol, unknown>;
      const value = handle[property];
      return typeof value === "function" ? value.bind(handle) : value;
    },
    set: (_target, property, value) => {
      (resolve() as unknown as Record<string | symbol, unknown>)[property] = value;
      return true;
    },
    has: (_target, property) => property in (resolve() as unknown as object),
    ownKeys: () => Reflect.ownKeys(resolve() as unknown as object),
    getOwnPropertyDescriptor: (_target, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve() as unknown as object, property);
      // The proxy target is a bare function, so every reported property has to
      // stay configurable to satisfy the proxy invariants.
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

export const db = lazyHandle<Knex>(() => resolveLegacyDatabaseHandle());

let cachedHandle: Knex | undefined;
let cachedClient: DatabaseClient | undefined;

function resolveClient(): DatabaseClient {
  const handle = resolveLegacyDatabaseHandle();
  if (cachedClient && cachedHandle === handle) return cachedClient;
  const client = Object.assign(
    <TName extends TableName>(table: TName) => handle<RowType<TName>, RowType<TName>[]>(table),
    handle,
  ) as unknown as DatabaseClient;
  client.schema = handle.schema;
  cachedHandle = handle;
  cachedClient = client;
  return client;
}

/**
 * Thin await of `openDatabase()` for callers that still import `dbReady`.
 * It is a thenable rather than an eager promise so importing this module does
 * not start any database work; the lifecycle runs on the first `await`.
 */
export const dbReady: PromiseLike<void> = {
  then(onfulfilled, onrejected) {
    const ready: Promise<void> = openDatabase().then(() => undefined);
    return ready.then(onfulfilled, onrejected);
  },
};

export default lazyHandle<DatabaseClient>(resolveClient);
