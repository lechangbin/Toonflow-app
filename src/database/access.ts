import type { Knex } from "knex";

import {
  resolveMaintenanceHandler,
  type MaintenanceCommand,
  type MaintenanceContext,
  type MaintenanceResultFor,
} from "./maintenance";
import { runDevelopmentPhase, runReadiness, type ReadinessContext } from "./readiness";

export type DatabaseRuntimeState = "opening" | "ready" | "maintenance" | "closed" | "unavailable";

export class DatabaseNotOpenError extends Error {
  constructor() {
    super("数据库尚未就绪：请先 await openDatabase()，成功后再读取运行时。");
    this.name = "DatabaseNotOpenError";
  }
}

export class DatabaseUnavailableError extends Error {
  constructor(state: DatabaseRuntimeState, cause?: unknown) {
    super(
      state === "closed"
        ? "数据库已关闭：运行时不再接受任何数据库工作。"
        : "数据库不可用：上一次维护或重新校验失败，请先排查错误后重新调用 openDatabase()。",
    );
    this.name = "DatabaseUnavailableError";
    this.cause = cause;
  }
}

/**
 * Coordinates every lease on one open database.
 *
 * Ordinary work shares a lease. Maintenance is writer-preferred: queueing a
 * command immediately parks new ordinary leases, the runner then waits for
 * in-flight work to drain, performs the mutation alone, replays the full
 * readiness lifecycle, and reopens access only after validation. A failed
 * maintenance or revalidation leaves the runtime unavailable instead of
 * silently falling back.
 */
export class DatabaseAccess {
  private currentState: DatabaseRuntimeState = "opening";
  private activeLeases = 0;
  private queuedMaintenance = 0;
  private maintenanceRunning = false;
  private gateWaiters: Array<() => void> = [];

  constructor(private readonly context: ReadinessContext) {}

  get state(): DatabaseRuntimeState {
    return this.currentState;
  }

  get databaseFile(): string {
    return this.context.databaseFile;
  }

  /** Runs the fixed readiness lifecycle and finishes with the development phase. */
  async start(): Promise<void> {
    await runReadiness(this.context);
    this.currentState = "ready";
    await runDevelopmentPhase(this.context);
  }

  async work<T>(operation: (db: Knex) => Promise<T> | T): Promise<T> {
    await this.acquireSharedLease();
    try {
      return await operation(this.context.knex);
    } finally {
      this.releaseSharedLease();
    }
  }

  async maintenance<TCommand extends MaintenanceCommand>(
    command: TCommand,
  ): Promise<MaintenanceResultFor<TCommand>> {
    this.assertAvailable();
    this.queuedMaintenance += 1;
    this.openGate();
    try {
      while (this.maintenanceRunning) await this.waitForGate();
      this.maintenanceRunning = true;
      try {
        await this.drainSharedLeases();
        this.currentState = "maintenance";

        const handler = resolveMaintenanceHandler(command);
        const maintenanceContext: MaintenanceContext = {
          knex: this.context.knex,
          dataRoot: this.context.dataRoot,
        };
        const result = await handler(maintenanceContext, command);

        await runReadiness(this.context);
        this.currentState = "ready";
        return result;
      } catch (error) {
        // A handler may reject its preflight without mutating, or fail mid-way
        // and roll back via its transaction. Revalidate whatever state remains:
        // a clean rollback reopens as ready, and only a failed revalidation
        // leaves the runtime unavailable.
        this.currentState = "unavailable";
        try {
          await runReadiness(this.context);
          this.currentState = "ready";
        } catch {
          // stays unavailable
        }
        throw error;
      } finally {
        this.maintenanceRunning = false;
      }
    } finally {
      this.queuedMaintenance -= 1;
      this.openGate();
    }
  }

  async close(): Promise<void> {
    while (this.maintenanceRunning || this.queuedMaintenance > 0 || this.activeLeases > 0) await this.waitForGate();
    if (this.currentState === "closed") return;
    this.currentState = "closed";
    this.openGate();
    await this.context.knex.destroy();
  }

  private assertAvailable(): void {
    if (this.currentState === "unavailable" || this.currentState === "closed") {
      throw new DatabaseUnavailableError(this.currentState);
    }
  }

  private async acquireSharedLease(): Promise<void> {
    for (;;) {
      this.assertAvailable();
      if (this.queuedMaintenance === 0) break;
      await this.waitForGate();
    }
    this.activeLeases += 1;
  }

  private releaseSharedLease(): void {
    this.activeLeases -= 1;
    if (this.activeLeases === 0) this.openGate();
  }

  private async drainSharedLeases(): Promise<void> {
    while (this.activeLeases > 0) await this.waitForGate();
  }

  private waitForGate(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.gateWaiters.push(resolve);
    });
  }

  private openGate(): void {
    const waiters = this.gateWaiters;
    this.gateWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
