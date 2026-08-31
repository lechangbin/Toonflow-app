import type { Knex } from "knex";

/**
 * Typed maintenance intents. Callers cannot supply arbitrary SQL or lifecycle
 * callbacks: they select one command from this union and the registry owns the
 * implementation.
 *
 * The exclusive runner reruns the whole readiness lifecycle after every handler
 * and reopens access only when validation passes, so a handler only has to
 * mutate. Adding a kind to `MaintenanceCommand` is a compile error until the
 * matching handler is registered below — that is the seam #15 extends with the
 * destructive `import`, `reset`, and `clearTable` commands.
 */
export interface VerifyMaintenanceCommand {
  readonly kind: "verify";
}

export type MaintenanceCommand = VerifyMaintenanceCommand;

export type MaintenanceCommandKind = MaintenanceCommand["kind"];

export interface VerifyMaintenanceResult {
  readonly kind: "verify";
  readonly verified: true;
}

export type MaintenanceResult = VerifyMaintenanceResult;

export type MaintenanceResultFor<TCommand extends MaintenanceCommand> = TCommand extends VerifyMaintenanceCommand
  ? VerifyMaintenanceResult
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

export const maintenanceRegistry: MaintenanceRegistry = {
  // `verify` performs no mutation. Its value is that the exclusive runner
  // reruns the full readiness lifecycle while every ordinary lease is parked.
  verify: async () => ({ kind: "verify", verified: true }),
};

export function resolveMaintenanceHandler<TCommand extends MaintenanceCommand>(
  command: TCommand,
): MaintenanceHandler<TCommand> {
  return maintenanceRegistry[command.kind] as MaintenanceHandler<TCommand>;
}
