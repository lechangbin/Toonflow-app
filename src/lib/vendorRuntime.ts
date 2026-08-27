import { transform } from "sucrase";

import runCode, { type VmBoundaryOverrides } from "@/utils/vm";
import getPath from "@/utils/getPath";
import { parseVideoModel, validateVideoGenerationCommand, type VideoModel } from "@/video/capability";
import { VideoPromptProfileRegistry } from "@/video/promptProfile";

export type VendorRequestName = "textRequest" | "imageRequest" | "videoRequest" | "ttsRequest";

export interface VendorModel {
  modelName: string;
  name?: string;
  type?: string;
  think?: boolean;
  [key: string]: unknown;
}

export interface VendorDefinition {
  id: string;
  name?: string;
  author?: string;
  description?: string;
  version?: string;
  inputs?: unknown;
  inputValues: Record<string, unknown>;
  models: VendorModel[];
  [key: string]: unknown;
}

export type VendorTextRequest = (think?: boolean, thinkLevel?: 0 | 1 | 2 | 3) => any;
export type VendorInputRequest = (input: unknown) => any;
export type VendorBoundRequest<Name extends VendorRequestName> = Name extends "textRequest"
  ? VendorTextRequest
  : VendorInputRequest;

export interface VendorRuntimeOptions {
  inputValues?: Record<string, unknown>;
  customModels?: VendorModel[];
  dependencyOverrides?: VmBoundaryOverrides;
  promptProfiles?: Pick<VideoPromptProfileRegistry, "get">;
}

export interface VendorRuntime {
  vendor: VendorDefinition;
  models: VendorModel[];
  getModel(modelName: string): VendorModel;
  getRequest<Name extends VendorRequestName>(fnName: Name, modelName: string): VendorBoundRequest<Name>;
}

function cloneModels(models: VendorModel[]): VendorModel[] {
  return JSON.parse(JSON.stringify(models));
}

function validateVendor(value: unknown): VendorDefinition {
  if (!value || typeof value !== "object") throw new Error("供应商配置缺少 vendor 导出");
  const vendor = value as Partial<VendorDefinition>;
  if (typeof vendor.id !== "string" || !vendor.id.trim()) throw new Error("供应商配置缺少有效 id");
  if (!vendor.inputValues || typeof vendor.inputValues !== "object" || Array.isArray(vendor.inputValues)) {
    throw new Error(`供应商 ${vendor.id} 缺少有效 inputValues`);
  }
  if (!Array.isArray(vendor.models)) throw new Error(`供应商 ${vendor.id} 缺少 models 数组`);
  return vendor as VendorDefinition;
}

function validateModels(vendorId: string, models: VendorModel[], promptProfiles?: Pick<VideoPromptProfileRegistry, "get">) {
  const modelNames = new Set<string>();
  return models.map((model) => {
    if (!model || typeof model.modelName !== "string" || !model.modelName.trim()) {
      throw new Error(`供应商 ${vendorId} 包含缺少 modelName 的模型`);
    }
    if (modelNames.has(model.modelName)) throw new Error(`供应商 ${vendorId} 重复声明模型 ${model.modelName}`);
    modelNames.add(model.modelName);
    if (model.type !== "video") return model;

    const videoModel = parseVideoModel(model);
    for (const capability of videoModel.capabilities) promptProfiles?.get(capability.promptProfileId);
    return videoModel as VideoModel & VendorModel;
  });
}

export function loadVendorRuntime(source: string, options: VendorRuntimeOptions = {}): VendorRuntime {
  const compiledSource = transform(source, { transforms: ["typescript"] }).code;
  const adapter = runCode(compiledSource, undefined, options.dependencyOverrides);
  const vendor = validateVendor(adapter.vendor);

  Object.assign(vendor.inputValues, options.inputValues ?? {});

  const builtInModels = validateModels(vendor.id, cloneModels(vendor.models));
  const customModels = validateModels(vendor.id, cloneModels(options.customModels ?? []));
  const combinedModels = [...builtInModels, ...customModels];
  const modelsByName = new Map<string, VendorModel>();
  for (const model of combinedModels) {
    modelsByName.set(model.modelName, model);
  }
  const models = [...modelsByName.values()];
  const hasVideoModels = models.some((model) => model.type === "video");
  const promptProfiles = hasVideoModels
    ? options.promptProfiles ?? VideoPromptProfileRegistry.load(getPath(["promptProfiles", "video"]))
    : undefined;
  const validatedModels = validateModels(vendor.id, models, promptProfiles);
  vendor.models = validatedModels;

  const getModel = (modelName: string) => {
    const model = validatedModels.find((item) => item.modelName === modelName);
    if (!model) throw new Error(`未找到模型 ${modelName} id=${vendor.id}`);
    return model;
  };

  return {
    vendor,
    models: validatedModels,
    getModel,
    getRequest(fnName, modelName) {
      const model = getModel(modelName);
      const request = adapter[fnName];
      if (typeof request !== "function") throw new Error(`未找到供应商配置中的函数 ${fnName} id=${vendor.id}`);

      if (fnName === "textRequest") {
        return ((think?: boolean, thinkLevel = 0) => request(model, think ?? !!model.think, thinkLevel)) as VendorBoundRequest<
          typeof fnName
        >;
      }

      if (fnName === "videoRequest") {
        return ((input: unknown) => request(validateVideoGenerationCommand(model, input), model)) as VendorBoundRequest<
          typeof fnName
        >;
      }

      return ((input: unknown) => request(input, model)) as VendorBoundRequest<typeof fnName>;
    },
  };
}
