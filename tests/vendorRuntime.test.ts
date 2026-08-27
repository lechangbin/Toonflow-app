import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadVendorRuntime } from "../src/lib/vendorRuntime";

const minimalVendorSource = `
const vendor = {
  id: "test-vendor",
  inputValues: {
    apiKey: "default-key",
    baseUrl: "https://default.invalid",
  },
  models: [],
};

exports.vendor = vendor;
export {};
`;

const modelVendorSource = `
const vendor = {
  id: "model-vendor",
  inputValues: {},
  models: [
    { name: "Built in", modelName: "built-in", type: "text", think: false },
    { name: "Replace me", modelName: "overridden", type: "text", think: false },
  ],
};

exports.vendor = vendor;
export {};
`;

const invalidRequestVendorSource = modelVendorSource.replace(
  "export {};",
  "exports.imageRequest = {};\nexport {};",
);

const requestVendorSource = `
const vendor = {
  id: "request-vendor",
  inputValues: {},
  models: [
    { name: "Text", modelName: "text-model", type: "text", think: true },
    { name: "Image", modelName: "image-model", type: "image" },
    { name: "Video", modelName: "video-model", type: "video" },
  ],
};

const textRequest = (model, think, thinkLevel) => ({ model, think, thinkLevel });
const imageRequest = (input, model) => ({ input, model });
const videoRequest = (input, model) => ({ input, model });

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
export {};
`;

test("loads Vendor source and applies runtime input values", () => {
  const runtime = loadVendorRuntime(minimalVendorSource, {
    inputValues: {
      apiKey: "runtime-key",
    },
  });

  assert.equal(runtime.vendor.id, "test-vendor");
  assert.deepEqual(runtime.vendor.inputValues, {
    apiKey: "runtime-key",
    baseUrl: "https://default.invalid",
  });
  assert.deepEqual(runtime.models, []);
});

test("merges custom models and selects them by modelName", () => {
  const runtime = loadVendorRuntime(modelVendorSource, {
    customModels: [
      { name: "Custom override", modelName: "overridden", type: "text", think: true },
      { name: "Custom only", modelName: "custom-only", type: "image" },
    ],
  });

  assert.deepEqual(
    runtime.models.map((model) => model.modelName),
    ["built-in", "overridden", "custom-only"],
  );
  assert.equal(runtime.getModel("built-in").name, "Built in");
  assert.equal(runtime.getModel("overridden").name, "Custom override");
  assert.equal(runtime.getModel("custom-only").name, "Custom only");
  assert.equal(runtime.vendor.models, runtime.models);
});

test("retrieves text, image, and video requests bound to their selected models", () => {
  const runtime = loadVendorRuntime(requestVendorSource);

  assert.deepEqual(runtime.getRequest("textRequest", "text-model")(), {
    model: runtime.getModel("text-model"),
    think: true,
    thinkLevel: 0,
  });
  assert.deepEqual(runtime.getRequest("textRequest", "text-model")(false, 2), {
    model: runtime.getModel("text-model"),
    think: false,
    thinkLevel: 2,
  });
  assert.deepEqual(runtime.getRequest("imageRequest", "image-model")({ prompt: "draw" }), {
    input: { prompt: "draw" },
    model: runtime.getModel("image-model"),
  });
  assert.deepEqual(runtime.getRequest("videoRequest", "video-model")({ prompt: "move" }), {
    input: { prompt: "move" },
    model: runtime.getModel("video-model"),
  });
});

test("reports compatible errors for missing models and request exports", () => {
  const runtime = loadVendorRuntime(modelVendorSource);

  assert.throws(
    () => runtime.getModel("missing"),
    new Error("未找到模型 missing id=model-vendor"),
  );
  assert.throws(
    () => runtime.getRequest("imageRequest", "built-in"),
    new Error("未找到供应商配置中的函数 imageRequest id=model-vendor"),
  );

  const invalidRuntime = loadVendorRuntime(invalidRequestVendorSource);
  assert.throws(
    () => invalidRuntime.getRequest("imageRequest", "built-in"),
    new Error("未找到供应商配置中的函数 imageRequest id=model-vendor"),
  );
});

test("loads the Agnes adapter through the runtime without making a network request", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "data/vendor/agnes.ts"), "utf8");
  const runtime = loadVendorRuntime(source, {
    inputValues: {
      apiKey: "test-key",
      baseUrl: "https://agnes.invalid",
    },
  });

  assert.equal(runtime.vendor.id, "agnes");
  assert.ok(runtime.getModel("agnes-2.5-flash"));
  assert.equal(typeof runtime.getRequest("videoRequest", "agnes-video-v2.0"), "function");
});
