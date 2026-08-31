import type { Knex } from "knex";

import { loadVendorRuntime, type VendorModel } from "@/lib/vendorRuntime";
import type { VideoPromptProfileRegistry } from "@/video/promptProfile";
import type { VmBoundaryOverrides } from "@/utils/vm";

import type {
  ConfiguredVendorModel,
  DirectModelTarget,
  ImageGenerationInput,
  ImageVendorModel,
  ModelSummary,
  TextLogicalKey,
  TextModelTarget,
  TextVendorModel,
  TtsGenerationInput,
  TtsVendorModel,
  ValidatedVideoGenerationCommand,
  VendorInputDeclaration,
  VendorModelType,
  VideoModel,
} from "./contract";

/**
 * The single configured Vendor loader. It is the only place that composes
 * persisted configuration, the Vendor program, Prompt Profiles, runtime
 * validation, effective Model resolution, and typed request binding. The
 * source-level runtime (`src/lib/vendorRuntime.ts`) stays an internal deep
 * module and is never surfaced to callers.
 */
export interface ConfiguredVendorDependencies {
  work<T>(operation: (db: Knex) => Promise<T> | T): Promise<T>;
  readVendorSource(vendorId: string): string;
  writeVendorSource(vendorId: string, source: string): void;
  deleteVendorSource(vendorId: string): void;
  promptProfiles: Pick<VideoPromptProfileRegistry, "get">;
  dependencyOverrides?: VmBoundaryOverrides;
}

export interface ConfiguredVendorConfig {
  inputValues: Record<string, unknown>;
  customModels: VendorModel[];
}

export interface LoadedConfiguredVendor {
  vendorId: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  inputs: VendorInputDeclaration[];
  inputValues: Record<string, unknown>;
  models: ConfiguredVendorModel[];
  modelTypes: VendorModelType[];
  requireText(modelId: string): TextVendorModel;
  requireImage(modelId: string): ImageVendorModel;
  requireVideo(modelId: string): VideoModel;
  requireTts(modelId: string): TtsVendorModel;
  bindText(modelId: string): (think?: boolean, thinkLevel?: 0 | 1 | 2 | 3) => any;
  bindImage(modelId: string): (input: ImageGenerationInput) => Promise<string>;
  bindVideo(modelId: string): (input: ValidatedVideoGenerationCommand) => Promise<string>;
  bindTts(modelId: string): (input: TtsGenerationInput) => Promise<string>;
}

export interface ResolvedTextModel {
  vendorId: string;
  modelId: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export async function readConfiguredVendorConfig(
  dependencies: ConfiguredVendorDependencies,
  vendorId: string,
): Promise<ConfiguredVendorConfig> {
  return dependencies.work(async (db) => {
    const row = await db("o_vendorConfig").where("id", vendorId).first();
    if (!row) throw new Error(`未找到供应商配置 id=${vendorId}`);
    return {
      inputValues: parseJsonObject(row.inputValues),
      customModels: parseJsonArray(row.models),
    };
  });
}

export async function loadConfiguredVendor(
  dependencies: ConfiguredVendorDependencies,
  vendorId: string,
): Promise<LoadedConfiguredVendor> {
  const source = dependencies.readVendorSource(vendorId);
  const config = await readConfiguredVendorConfig(dependencies, vendorId);
  const runtime = loadVendorRuntime(source, {
    inputValues: config.inputValues,
    customModels: config.customModels,
    promptProfiles: dependencies.promptProfiles,
    dependencyOverrides: dependencies.dependencyOverrides,
  });
  return buildLoadedVendor(vendorId, runtime);
}

/**
 * Validates a candidate configuration against the Vendor program before it is
 * persisted. Reuses the same source-level runtime validation, so Video Models,
 * Video Capabilities, and Prompt Profiles are checked exactly once more at the
 * provider-independent seam.
 */
export function validateVendorConfiguration(
  dependencies: ConfiguredVendorDependencies,
  vendorId: string,
  config: ConfiguredVendorConfig,
): LoadedConfiguredVendor {
  const source = dependencies.readVendorSource(vendorId);
  const runtime = loadVendorRuntime(source, {
    inputValues: config.inputValues,
    customModels: config.customModels,
    promptProfiles: dependencies.promptProfiles,
    dependencyOverrides: dependencies.dependencyOverrides,
  });
  const loaded = buildLoadedVendor(vendorId, runtime);
  for (const type of loaded.modelTypes) {
    const model = loaded.models.find((candidate) => candidate.type === type);
    if (!model) continue;
    switch (type) {
      case "text":
        loaded.bindText(model.modelName);
        break;
      case "image":
        loaded.bindImage(model.modelName);
        break;
      case "video":
        loaded.bindVideo(model.modelName);
        break;
      case "tts":
        loaded.bindTts(model.modelName);
        break;
    }
  }
  return loaded;
}

function buildLoadedVendor(
  vendorId: string,
  runtime: ReturnType<typeof loadVendorRuntime>,
): LoadedConfiguredVendor {
  const { vendor } = runtime;
  if (vendor.id !== vendorId) {
    throw new Error(`供应商源文件 ${vendorId} 导出的 Vendor id 是 ${vendor.id}`);
  }

  const models = runtime.models as ConfiguredVendorModel[];
  const getModel = (modelId: string): VendorModel => runtime.getModel(modelId);

  const requireModel = (modelId: string, type: VendorModelType): VendorModel => {
    const model = getModel(modelId);
    if (model.type !== type) {
      throw new Error(`模型 ${vendorId}:${modelId} 不是 ${type} 模型`);
    }
    return model;
  };

  return {
    vendorId: vendor.id,
    name: typeof vendor.name === "string" ? vendor.name : vendor.id,
    version: typeof vendor.version === "string" ? vendor.version : undefined,
    description: typeof vendor.description === "string" ? vendor.description : undefined,
    author: typeof vendor.author === "string" ? vendor.author : undefined,
    inputs: normalizeInputs(vendor.inputs),
    inputValues: vendor.inputValues,
    models,
    modelTypes: uniqueModelTypes(models),
    requireText: (modelId) => requireModel(modelId, "text") as TextVendorModel,
    requireImage: (modelId) => requireModel(modelId, "image") as ImageVendorModel,
    requireVideo: (modelId) => requireModel(modelId, "video") as VideoModel,
    requireTts: (modelId) => requireModel(modelId, "tts") as TtsVendorModel,
    bindText: (modelId) => runtime.getRequest("textRequest", modelId) as (think?: boolean, thinkLevel?: 0 | 1 | 2 | 3) => any,
    bindImage: (modelId) => runtime.getRequest("imageRequest", modelId) as (input: ImageGenerationInput) => Promise<string>,
    bindVideo: (modelId) => runtime.getRequest("videoRequest", modelId) as (input: ValidatedVideoGenerationCommand) => Promise<string>,
    bindTts: (modelId) => runtime.getRequest("ttsRequest", modelId) as (input: TtsGenerationInput) => Promise<string>,
  };
}

/**
 * Resolves a Text target to a concrete Vendor/Model plus the persisted tuning
 * fields, preserving simple (`agentUseMode=0`), advanced (`agentUseMode=1`),
 * and fallback behaviour from the historical Agent deploy path.
 */
export async function resolveTextTarget(
  dependencies: ConfiguredVendorDependencies,
  target: TextModelTarget,
): Promise<ResolvedTextModel> {
  if (target.kind === "direct") return { vendorId: target.vendorId, modelId: target.modelId };

  const key = target.key;
  const mode = await readAgentUseMode(dependencies);

  if (mode === "1") {
    const deploy = await dependencies.work((db) => db("o_agentDeploy").where("key", key).first());
    if (!deploy?.modelName) throw new Error(`高级配置模式下，未找到对应的模型配置 ${key}`);
    return parseResolvedTextModel(deploy.modelName, deploy);
  }

  if (mode === "0") {
    const deploy = await dependencies.work((db) => db("o_agentDeploy").where("key", parentKey(key)).first());
    if (!deploy?.modelName) throw new Error(`简易配置模式下，未找到部署配置 ${key}`);
    return parseResolvedTextModel(deploy.modelName, deploy);
  }

  const deploy = await dependencies.work((db) => db("o_agentDeploy").where("key", key).first());
  if (deploy?.modelName) return parseResolvedTextModel(deploy.modelName, deploy);

  const parent = await dependencies.work((db) => db("o_agentDeploy").where("key", parentKey(key)).first());
  if (!parent?.modelName) throw new Error(`未找到部署配置 ${key}`);
  return parseResolvedTextModel(parent.modelName, parent);
}

export function summarizeModel(model: ConfiguredVendorModel): ModelSummary {
  if (model.type === "text") {
    return { type: "text", name: model.name, modelName: model.modelName, think: model.think === true };
  }
  if (model.type === "image") {
    return {
      type: "image",
      name: model.name,
      modelName: model.modelName,
      mode: Array.isArray(model.mode) ? (model.mode as ("text" | "singleImage" | "multiReference")[]) : [],
    };
  }
  if (model.type === "tts") {
    return { type: "tts", name: model.name, modelName: model.modelName };
  }
  return { type: "video", name: model.name, modelName: model.modelName, capabilities: model.capabilities };
}

function readAgentUseMode(dependencies: ConfiguredVendorDependencies): Promise<string | null> {
  return dependencies.work(async (db) => {
    const row = await db("o_setting").where("key", "agentUseMode").first();
    return typeof row?.value === "string" ? row.value : null;
  });
}

function parentKey(key: TextLogicalKey): string {
  return key.split(/:(.+)/)[0];
}

function parseResolvedTextModel(
  modelName: string,
  deploy: { temperature?: number | null; maxOutputTokens?: number | null },
): ResolvedTextModel {
  const target = parseVendorModelName(modelName);
  return {
    ...target,
    temperature: typeof deploy.temperature === "number" ? deploy.temperature : undefined,
    maxOutputTokens: typeof deploy.maxOutputTokens === "number" ? deploy.maxOutputTokens : undefined,
  };
}

/** Splits a persisted `vendorId:modelId` binding without touching the database row. */
export function parseVendorModelName(modelName: string): DirectModelTarget {
  const separator = modelName.indexOf(":");
  if (separator <= 0 || separator === modelName.length - 1) {
    throw new Error(`模型配置格式无效 ${modelName}`);
  }
  return { vendorId: modelName.slice(0, separator), modelId: modelName.slice(separator + 1) };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = JSON.parse(typeof value === "string" ? value : "{}");
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function parseJsonArray(value: unknown): VendorModel[] {
  const parsed = JSON.parse(typeof value === "string" ? value : "[]");
  return Array.isArray(parsed) ? (parsed as VendorModel[]) : [];
}

function normalizeInputs(value: unknown): VendorInputDeclaration[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((input) => {
    if (!input || typeof input !== "object") return [];
    const item = input as Record<string, unknown>;
    if (typeof item.key !== "string") return [];
    return [
      {
        key: item.key,
        label: typeof item.label === "string" ? item.label : undefined,
        type: typeof item.type === "string" ? item.type : undefined,
        required: item.required === true,
        placeholder: typeof item.placeholder === "string" ? item.placeholder : undefined,
      },
    ];
  });
}

function uniqueModelTypes(models: readonly ConfiguredVendorModel[]): VendorModelType[] {
  const seen = new Set<VendorModelType>();
  for (const model of models) {
    if (model.type === "text" || model.type === "image" || model.type === "video" || model.type === "tts") {
      seen.add(model.type);
    }
  }
  return [...seen];
}
