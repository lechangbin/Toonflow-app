import { transform } from "sucrase";

import runCode, { type VmBoundaryOverrides } from "@/utils/vm";

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

export function loadVendorRuntime(source: string, options: VendorRuntimeOptions = {}): VendorRuntime {
  const compiledSource = transform(source, { transforms: ["typescript"] }).code;
  const adapter = runCode(compiledSource, undefined, options.dependencyOverrides);
  const vendor = adapter.vendor as VendorDefinition;

  Object.assign(vendor.inputValues, options.inputValues);

  const combinedModels = [...cloneModels(vendor.models), ...cloneModels(options.customModels ?? [])];
  const modelsByName = new Map<string, VendorModel>();
  for (const model of combinedModels) {
    modelsByName.set(model.modelName, model);
  }
  const models = [...modelsByName.values()];
  vendor.models = models;

  const getModel = (modelName: string) => {
    const model = models.find((item) => item.modelName === modelName);
    if (!model) throw new Error(`未找到模型 ${modelName} id=${vendor.id}`);
    return model;
  };

  return {
    vendor,
    models,
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

      return ((input: unknown) => request(input, model)) as VendorBoundRequest<typeof fnName>;
    },
  };
}
