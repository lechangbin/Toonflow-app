import { transform } from "sucrase";

import runCode, { type VmBoundaryOverrides } from "@/utils/vm";

export type VendorRequestName = "textRequest" | "imageRequest" | "videoRequest" | "ttsRequest";

export interface VendorRuntimeOptions {
  inputValues?: Record<string, unknown>;
  customModels?: Record<string, any>[];
  dependencyOverrides?: VmBoundaryOverrides;
}

export interface VendorRuntime {
  vendor: Record<string, any>;
  models: Record<string, any>[];
  getModel(modelName: string): Record<string, any>;
  getRequest(fnName: VendorRequestName, modelName: string): (...args: any[]) => any;
}

export function loadVendorRuntime(source: string, options: VendorRuntimeOptions = {}): VendorRuntime {
  const compiledSource = transform(source, { transforms: ["typescript"] }).code;
  const adapter = runCode(compiledSource, undefined, options.dependencyOverrides);
  const vendor = adapter.vendor;

  Object.assign(vendor.inputValues, options.inputValues);

  const combinedModels = [
    ...JSON.parse(JSON.stringify(vendor.models)),
    ...JSON.parse(JSON.stringify(options.customModels ?? [])),
  ];
  const modelsByName = new Map<string, Record<string, any>>();
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
      if (!request) throw new Error(`未找到供应商配置中的函数 ${fnName} id=${vendor.id}`);

      if (fnName === "textRequest") {
        return (think?: boolean, thinkLevel = 0) => request(model, think ?? !!model.think, thinkLevel);
      }

      return (input: unknown) => request(input, model);
    },
  };
}
