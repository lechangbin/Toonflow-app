import type { Knex } from "knex";

import type {
  ConfiguredVendorCommand,
  ConfiguredVendorResultFor,
} from "./contract";
import { validateVendorConfiguration, type ConfiguredVendorConfig, type ConfiguredVendorDependencies } from "./loader";
import { validateConfiguredVendorsWith } from "./startup";

/**
 * Typed configuration-command seam. Callers select one command from the union
 * and the registry owns the implementation, mirroring the database maintenance
 * seam. No command exposes a raw SQL handle, JSON persistence, or a request name.
 */
export type ConfiguredVendorConfigRunner = {
  configure<TCommand extends ConfiguredVendorCommand>(command: TCommand): Promise<ConfiguredVendorResultFor<TCommand>>;
};

type ConfigHandler<TCommand extends ConfiguredVendorCommand> = (
  dependencies: ConfiguredVendorDependencies,
  command: TCommand,
) => Promise<ConfiguredVendorResultFor<TCommand>>;

export function createConfiguredVendorConfigRunner(dependencies: ConfiguredVendorDependencies): ConfiguredVendorConfigRunner {
  return {
    configure: (command) => resolveHandler(command)(dependencies, command),
  };
}

function resolveHandler<TCommand extends ConfiguredVendorCommand>(
  command: TCommand,
): ConfigHandler<TCommand> {
  return (handlers[command.kind] as ConfigHandler<TCommand>);
}

const handlers: { [K in ConfiguredVendorCommand["kind"]]: ConfigHandler<Extract<ConfiguredVendorCommand, { kind: K }>> } = {
  validate: async (dependencies) => ({
    kind: "validate",
    result: await validateConfiguredVendorsWith(dependencies),
  }),

  "set-vendor-config": async (dependencies, command) => {
    const config: ConfiguredVendorConfig = {
      inputValues: command.inputValues,
      customModels: [...command.customModels],
    };
    validateVendorConfiguration(dependencies, command.vendorId, config);
    await dependencies.work(async (db: Knex) => {
      await db("o_vendorConfig").where("id", command.vendorId).update({
        inputValues: JSON.stringify(command.inputValues),
        models: JSON.stringify(command.customModels),
      });
    });
    return { kind: "set-vendor-config", vendorId: command.vendorId };
  },
};
