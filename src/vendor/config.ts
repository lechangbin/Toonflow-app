import type { Knex } from "knex";

import { isBuiltInVendor } from "@/lib/vendorRegistry";
import { loadVendorRuntime, validateVendorRequiredInputs, type VendorModel, type VendorRequestName } from "@/lib/vendorRuntime";

import type {
  AgentBindingUpdate,
  ConfiguredVendorCommand,
  ConfiguredVendorResultFor,
} from "./contract";
import { VendorConfigConflictError, VendorConfigNotFoundError } from "./errors";
import {
  loadConfiguredVendor,
  parseVendorModelName,
  readConfiguredVendorConfig,
  validateVendorConfiguration,
  type ConfiguredVendorConfig,
  type ConfiguredVendorDependencies,
} from "./loader";
import { validateConfiguredVendorsWith } from "./startup";

/**
 * Typed configuration-command seam. Callers select one command from the union
 * and the registry owns the implementation, mirroring the database maintenance
 * seam. No command exposes a raw SQL handle, JSON persistence, or a request name.
 *
 * Every mutating command validates its candidate state before touching the
 * database or filesystem. Filesystem side-effects are snapshotted and restored
 * when the database transaction fails, so a partial failure never leaves a
 * previously configured state half-committed.
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

  add: async (dependencies, command) => {
    const runtime = loadVendorRuntime(command.source);
    assertSourceRequestExports(runtime);
    const vendorId = runtime.vendor.id;
    if (vendorId.includes(":")) throw new Error("id不能包含英文冒号");
    if (isBuiltInVendor(vendorId)) throw new VendorConfigConflictError("供应商id已存在");

    const snapshot = captureVendorSource(dependencies, vendorId);
    dependencies.writeVendorSource(vendorId, command.source);
    try {
      await dependencies.work(async (db: Knex) => {
        await db.transaction(async (trx) => {
          const existing = await trx("o_vendorConfig").where("id", vendorId).first();
          if (existing) throw new VendorConfigConflictError("供应商id已存在");
          await trx("o_vendorConfig").insert({
            id: vendorId,
            inputValues: JSON.stringify(runtime.vendor.inputValues),
            models: "[]",
            enable: 0,
          });
        });
      });
    } catch (cause) {
      restoreVendorSource(dependencies, snapshot);
      throw cause;
    }
    return { kind: "add", vendorId };
  },

  "program-update": async (dependencies, command) => {
    const current = await dependencies.work(async (db) => db("o_vendorConfig").where("id", command.vendorId).first());
    if (!current) throw new VendorConfigNotFoundError("供应商不存在");

    const config = await readConfiguredVendorConfig(dependencies, command.vendorId);
    const runtime = loadVendorRuntime(command.source, {
      inputValues: config.inputValues,
      customModels: config.customModels,
    });
    if (runtime.vendor.id !== command.vendorId) throw new Error("Vendor id 不允许在更新时改变");
    assertSourceRequestExports(runtime);

    const snapshot = captureVendorSource(dependencies, command.vendorId);
    try {
      dependencies.writeVendorSource(command.vendorId, command.source);
    } catch (cause) {
      restoreVendorSource(dependencies, snapshot);
      throw cause;
    }
    return { kind: "program-update", vendorId: command.vendorId };
  },

  "input-update": async (dependencies, command) => {
    const current = await dependencies.work(async (db) => db("o_vendorConfig").where("id", command.vendorId).first());
    if (!current) throw new VendorConfigNotFoundError(`未找到供应商配置 id=${command.vendorId}`);

    const config = await readConfiguredVendorConfig(dependencies, command.vendorId);
    const candidate: ConfiguredVendorConfig = { inputValues: command.inputValues, customModels: config.customModels };
    const loaded = validateVendorConfiguration(dependencies, command.vendorId, candidate);
    if (current.enable === 1) {
      validateVendorRequiredInputs({
        id: loaded.vendorId,
        inputValues: candidate.inputValues,
        inputs: loaded.inputs,
        models: loaded.models,
      });
    }

    await dependencies.work(async (db: Knex) => {
      await db("o_vendorConfig").where("id", command.vendorId).update({
        inputValues: JSON.stringify(command.inputValues),
      });
    });
    return { kind: "input-update", vendorId: command.vendorId };
  },

  "custom-model-update": async (dependencies, command) => {
    const current = await dependencies.work(async (db) => db("o_vendorConfig").where("id", command.vendorId).first());
    if (!current) throw new VendorConfigNotFoundError(`未找到供应商配置 id=${command.vendorId}`);

    const config = await readConfiguredVendorConfig(dependencies, command.vendorId);
    const existing = config.customModels.slice();
    const index = existing.findIndex((model) => model.modelName === command.model.modelName);
    if (index === -1) existing.push(command.model as VendorModel);
    else existing[index] = command.model as VendorModel;

    validateVendorConfiguration(dependencies, command.vendorId, {
      inputValues: config.inputValues,
      customModels: existing,
    });

    await dependencies.work(async (db: Knex) => {
      await db("o_vendorConfig").where("id", command.vendorId).update({ models: JSON.stringify(existing) });
    });
    return { kind: "custom-model-update", vendorId: command.vendorId };
  },

  "custom-model-remove": async (dependencies, command) => {
    const current = await dependencies.work(async (db) => db("o_vendorConfig").where("id", command.vendorId).first());
    if (!current) throw new VendorConfigNotFoundError(`未找到供应商配置 id=${command.vendorId}`);

    const config = await readConfiguredVendorConfig(dependencies, command.vendorId);
    const existing = config.customModels;
    if (!existing.some((model) => model.modelName === command.modelName)) {
      throw new Error("基本模型不允许删除");
    }
    const next = existing.filter((model) => model.modelName !== command.modelName);

    validateVendorConfiguration(dependencies, command.vendorId, {
      inputValues: config.inputValues,
      customModels: next,
    });

    await dependencies.work(async (db: Knex) => {
      await db("o_vendorConfig").where("id", command.vendorId).update({ models: JSON.stringify(next) });
    });
    return { kind: "custom-model-remove", vendorId: command.vendorId };
  },

  "enable-disable": async (dependencies, command) => {
    const current = await dependencies.work(async (db) => db("o_vendorConfig").where("id", command.vendorId).first());
    if (!current) throw new VendorConfigNotFoundError(`未找到供应商配置 id=${command.vendorId}`);

    if (command.enable) {
      const config = await readConfiguredVendorConfig(dependencies, command.vendorId);
      const loaded = validateVendorConfiguration(dependencies, command.vendorId, config);
      validateVendorRequiredInputs({
        id: loaded.vendorId,
        inputValues: loaded.inputValues,
        inputs: loaded.inputs,
        models: loaded.models,
      });
    }

    await dependencies.work(async (db: Knex) => {
      await db("o_vendorConfig").where("id", command.vendorId).update({ enable: command.enable ? 1 : 0 });
    });
    return { kind: "enable-disable", vendorId: command.vendorId };
  },

  delete: async (dependencies, command) => {
    const snapshot = captureVendorSource(dependencies, command.vendorId);
    dependencies.deleteVendorSource(command.vendorId);
    try {
      await dependencies.work(async (db: Knex) => {
        await db.transaction(async (trx) => {
          await trx("o_vendorConfig").where("id", command.vendorId).del();
          await trx("o_agentDeploy").where("vendorId", command.vendorId).update({
            model: null,
            modelName: null,
            vendorId: null,
          });
          await trx("o_agentDeploy").where("modelName", "like", `${command.vendorId}:%`).update({
            model: null,
            modelName: null,
            vendorId: null,
          });
        });
      });
    } catch (cause) {
      restoreVendorSource(dependencies, snapshot);
      throw cause;
    }
    return { kind: "delete", vendorId: command.vendorId };
  },

  "agent-mode": async (dependencies, command) => {
    await dependencies.work(async (db: Knex) => {
      await db("o_setting").where("key", "agentUseMode").update({ value: command.mode });
    });
    return { kind: "agent-mode", mode: command.mode };
  },

  "agent-binding": async (dependencies, command) => {
    for (const binding of command.bindings) {
      if (!binding.modelName) continue;
      const target = parseVendorModelName(binding.modelName);
      const row = await dependencies.work(async (db) => db("o_vendorConfig").where("id", target.vendorId).first());
      if (!row) throw new Error(`未找到供应商配置 id=${target.vendorId}`);
      if (row.enable !== 1) throw new Error(`供应商 ${target.vendorId} 未启用`);
      const loaded = await loadConfiguredVendor(dependencies, target.vendorId);
      loaded.requireText(target.modelId);
    }

    await dependencies.work(async (db: Knex) => {
      await db.transaction(async (trx) => {
        for (const binding of command.bindings) {
          await trx("o_agentDeploy").where("id", binding.id).update(bindingPatch(binding));
        }
      });
    });
    return { kind: "agent-binding", count: command.bindings.length };
  },
};

function assertSourceRequestExports(runtime: ReturnType<typeof loadVendorRuntime>): void {
  const requestByType: Record<string, VendorRequestName> = {
    text: "textRequest",
    image: "imageRequest",
    video: "videoRequest",
    tts: "ttsRequest",
  };
  for (const model of runtime.models) {
    const requestName = model.type ? requestByType[model.type] : undefined;
    if (requestName) runtime.getRequest(requestName, model.modelName);
  }
}

function bindingPatch(binding: AgentBindingUpdate): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    name: binding.name,
    model: binding.model,
    modelName: binding.modelName,
    vendorId: binding.vendorId,
    desc: binding.desc,
  };
  if (binding.temperature !== undefined) patch.temperature = binding.temperature;
  if (binding.maxOutputTokens !== undefined) patch.maxOutputTokens = binding.maxOutputTokens;
  return patch;
}

interface VendorSourceSnapshot {
  vendorId: string;
  existed: boolean;
  content: string;
}

function captureVendorSource(dependencies: ConfiguredVendorDependencies, vendorId: string): VendorSourceSnapshot {
  try {
    return { vendorId, existed: true, content: dependencies.readVendorSource(vendorId) };
  } catch {
    return { vendorId, existed: false, content: "" };
  }
}

function restoreVendorSource(dependencies: ConfiguredVendorDependencies, snapshot: VendorSourceSnapshot): void {
  if (snapshot.existed) {
    dependencies.writeVendorSource(snapshot.vendorId, snapshot.content);
  } else {
    dependencies.deleteVendorSource(snapshot.vendorId);
  }
}
