import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";

import type { VmBoundaryOverrides } from "../src/utils/vm";
import { VideoPromptProfileRegistry } from "../src/video/promptProfile";
import { createConfiguredVendor, type ConfiguredVendorDependencies } from "../src/vendor";
import { resolveTextTarget } from "../src/vendor/loader";

const promptProfiles = VideoPromptProfileRegistry.load(path.join(process.cwd(), "data", "promptProfiles", "video"));

const imageVendorSource = `
const vendor = {
  id: "image-vendor",
  name: "Image Vendor",
  inputValues: {},
  models: [{ name: "Image Model", modelName: "image-model", type: "image" }],
};
const imageRequest = (input, model) => Promise.resolve(JSON.stringify({ prompt: input.prompt, model: model.modelName }));
exports.vendor = vendor;
exports.imageRequest = imageRequest;
export {};
`;

const ttsVendorSource = `
const vendor = {
  id: "tts-vendor",
  inputValues: {},
  models: [{ name: "TTS Model", modelName: "tts-model", type: "tts", voices: [] }],
};
const ttsRequest = (input, model) => Promise.resolve(input.text + "|" + model.modelName);
exports.vendor = vendor;
exports.ttsRequest = ttsRequest;
export {};
`;

const videoVendorSource = `
const vendor = {
  id: "video-vendor",
  inputValues: {},
  models: [{
    name: "Video Model",
    modelName: "video-model",
    type: "video",
    capabilities: [{
      id: "text-to-video",
      promptProfileId: "minimax/text-v1",
      inputs: [],
      audio: { generation: "none", policy: "none" },
      outputPresets: [{ id: "720p", resolution: "720p", durations: { kind: "values", values: [5] }, aspectRatios: ["16:9"] }],
    }],
  }],
};
const videoRequest = (input, model) => Promise.resolve("video-output");
exports.vendor = vendor;
exports.videoRequest = videoRequest;
export {};
`;

const textVendorSource = `
const vendor = {
  id: "text-vendor",
  inputValues: {},
  models: [{ name: "Text Model", modelName: "text-model", type: "text", think: true }],
};
const textRequest = (model, think, thinkLevel) =>
  createOpenAICompatible({ name: "mock" }).chatModel(model.modelName + "|" + think + "|" + thinkLevel);
exports.vendor = vendor;
exports.textRequest = textRequest;
export {};
`;

const configVendorSource = `
const vendor = {
  id: "config-vendor",
  inputValues: { apiKey: "" },
  models: [
    { name: "Built in", modelName: "built-in", type: "text", think: false },
    { name: "Image Built in", modelName: "img", type: "image" },
  ],
};
const imageRequest = (input, model) => Promise.resolve(vendor.inputValues.apiKey);
const textRequest = (model, think, thinkLevel) => ({});
exports.vendor = vendor;
exports.imageRequest = imageRequest;
exports.textRequest = textRequest;
export {};
`;

const missingRequestVendorSource = `
const vendor = {
  id: "missing-request-vendor",
  inputValues: {},
  models: [{ name: "Image Model", modelName: "image-model", type: "image" }],
};
exports.vendor = vendor;
export {};
`;

const requiredInputVendorSource = `
const vendor = {
  id: "required-input-vendor",
  inputValues: { apiKey: "" },
  inputs: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
  models: [{ name: "Image Model", modelName: "image-model", type: "image" }],
};
const imageRequest = (input, model) => Promise.resolve("ok");
exports.vendor = vendor;
exports.imageRequest = imageRequest;
export {};
`;

const cannedUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function makeLanguageModel(modelId: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    modelId,
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: "hello" }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: cannedUsage,
      warnings: [],
    }),
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "hello" },
        { type: "text-end", id: "t1" },
        { type: "finish", usage: cannedUsage, finishReason: { unified: "stop" as const, raw: "stop" } },
      ]),
    }),
  });
}

async function createKnex(): Promise<Knex> {
  const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await knex.schema.createTable("o_vendorConfig", (table) => {
    table.string("id").primary();
    table.text("inputValues");
    table.text("models");
    table.integer("enable");
  });
  await knex.schema.createTable("o_agentDeploy", (table) => {
    table.string("key").primary();
    table.string("modelName");
    table.integer("temperature");
    table.integer("maxOutputTokens");
  });
  await knex.schema.createTable("o_setting", (table) => {
    table.string("key").primary();
    table.text("value");
  });
  return knex;
}

function makeDeps(knex: Knex, sources: Record<string, string>, overrides: VmBoundaryOverrides = {}): ConfiguredVendorDependencies {
  const store = new Map(Object.entries(sources));
  return {
    work: async (operation) => operation(knex),
    readVendorSource: (vendorId) => {
      const source = store.get(vendorId);
      if (!source) throw new Error(`未找到供应商配置文件 ${vendorId}.ts`);
      return source;
    },
    writeVendorSource: (vendorId, source) => {
      store.set(vendorId, source);
    },
    deleteVendorSource: (vendorId) => {
      store.delete(vendorId);
    },
    promptProfiles,
    dependencyOverrides: overrides,
  };
}

const validVideoCommand = {
  capabilityId: "text-to-video" as const,
  modelId: "video-model",
  prompt: "move",
  output: { presetId: "720p", duration: 5, resolution: "720p", aspectRatio: "16:9" as const },
  audio: { generation: "none" as const },
};

test("generates an image through a typed direct target", async () => {
  const knex = await createKnex();
  try {
    await knex("o_vendorConfig").insert({ id: "image-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const vendor = createConfiguredVendor(makeDeps(knex, { "image-vendor": imageVendorSource }));

    const result = await vendor.generateImage({
      target: { vendorId: "image-vendor", modelId: "image-model" },
      input: { prompt: "draw", size: "1K", aspectRatio: "16:9" },
    });

    assert.equal(result, JSON.stringify({ prompt: "draw", model: "image-model" }));
  } finally {
    await knex.destroy();
  }
});

test("generates TTS through a typed direct target", async () => {
  const knex = await createKnex();
  try {
    await knex("o_vendorConfig").insert({ id: "tts-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const vendor = createConfiguredVendor(makeDeps(knex, { "tts-vendor": ttsVendorSource }));

    const result = await vendor.generateTts({
      target: { vendorId: "tts-vendor", modelId: "tts-model" },
      input: { text: "hello", voice: "v1", speechRate: 1, pitchRate: 1, volume: 1 },
    });

    assert.equal(result, "hello|tts-model");
  } finally {
    await knex.destroy();
  }
});

test("generates video and re-validates the command at the provider-independent seam", async () => {
  const knex = await createKnex();
  try {
    await knex("o_vendorConfig").insert({ id: "video-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const vendor = createConfiguredVendor(makeDeps(knex, { "video-vendor": videoVendorSource }));

    const result = await vendor.generateVideo({ target: { vendorId: "video-vendor", modelId: "video-model" }, input: validVideoCommand });
    assert.equal(result, "video-output");

    await assert.rejects(
      () =>
        vendor.generateVideo({
          target: { vendorId: "video-vendor", modelId: "video-model" },
          input: { ...validVideoCommand, modelId: "wrong-model" },
        }),
      /does not match/,
    );
  } finally {
    await knex.destroy();
  }
});

test("rejects a model of the wrong operation type", async () => {
  const knex = await createKnex();
  try {
    await knex("o_vendorConfig").insert({ id: "video-vendor", inputValues: "{}", models: "[]", enable: 0 });
    await knex("o_vendorConfig").insert({ id: "image-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const vendor = createConfiguredVendor(
      makeDeps(knex, { "video-vendor": videoVendorSource, "image-vendor": imageVendorSource }),
    );

    await assert.rejects(
      () =>
        vendor.generateImage({
          target: { vendorId: "video-vendor", modelId: "video-model" },
          input: { prompt: "p", size: "1K", aspectRatio: "1:1" },
        }),
      /不是 image 模型/,
    );
    await assert.rejects(
      () => vendor.generateVideo({ target: { vendorId: "image-vendor", modelId: "image-model" }, input: validVideoCommand }),
      /不是 video 模型/,
    );
  } finally {
    await knex.destroy();
  }
});

test("merges persisted input values and custom models through the loader", async () => {
  const knex = await createKnex();
  try {
    await knex("o_vendorConfig").insert({
      id: "config-vendor",
      inputValues: JSON.stringify({ apiKey: "persisted-key" }),
      models: JSON.stringify([{ name: "Custom override", modelName: "built-in", type: "text", think: true }]),
      enable: 0,
    });
    const vendor = createConfiguredVendor(makeDeps(knex, { "config-vendor": configVendorSource }));

    const generated = await vendor.generateImage({
      target: { vendorId: "config-vendor", modelId: "img" },
      input: { prompt: "p", size: "1K", aspectRatio: "1:1" },
    });
    assert.equal(generated, "persisted-key");

    const inspection = await vendor.inspectVendor("config-vendor");
    const textModel = inspection.models.find((model) => model.type === "text");
    assert.ok(textModel);
    assert.equal(textModel.name, "Custom override");
    assert.equal(textModel.type === "text" ? textModel.think : false, true);
  } finally {
    await knex.destroy();
  }
});

test("resolves logical text targets across advanced, simple, and fallback modes", async () => {
  const knex = await createKnex();
  const deps = makeDeps(knex, {});
  try {
    await knex("o_agentDeploy").insert([
      { key: "scriptAgent", modelName: "text-vendor:text-model", temperature: 7, maxOutputTokens: 2048 },
      { key: "scriptAgent:decisionAgent", modelName: "text-vendor:text-model", temperature: 1, maxOutputTokens: 100 },
    ]);

    // Advanced mode: full key wins.
    await knex("o_setting").insert({ key: "agentUseMode", value: "1" });
    assert.deepEqual(await resolveTextTarget(deps, { kind: "logical", key: "scriptAgent:decisionAgent" }), {
      vendorId: "text-vendor",
      modelId: "text-model",
      temperature: 1,
      maxOutputTokens: 100,
    });

    // Simple mode: parent role wins.
    await knex("o_setting").where("key", "agentUseMode").update({ value: "0" });
    assert.deepEqual(await resolveTextTarget(deps, { kind: "logical", key: "scriptAgent:decisionAgent" }), {
      vendorId: "text-vendor",
      modelId: "text-model",
      temperature: 7,
      maxOutputTokens: 2048,
    });

    // Fallback (no mode): full key first, then parent.
    await knex("o_setting").where("key", "agentUseMode").del();
    assert.deepEqual(await resolveTextTarget(deps, { kind: "logical", key: "scriptAgent" }), {
      vendorId: "text-vendor",
      modelId: "text-model",
      temperature: 7,
      maxOutputTokens: 2048,
    });

    // Direct targets pass through untouched.
    assert.deepEqual(await resolveTextTarget(deps, { kind: "direct", vendorId: "v", modelId: "m" }), {
      vendorId: "v",
      modelId: "m",
    });
  } finally {
    await knex.destroy();
  }
});

test("invokes and streams text with the resolved logical model", async () => {
  const knex = await createKnex();
  const createdModelIds: string[] = [];
  try {
    await knex("o_vendorConfig").insert({ id: "text-vendor", inputValues: "{}", models: "[]", enable: 0 });
    await knex("o_agentDeploy").insert({ key: "scriptAgent", modelName: "text-vendor:text-model" });
    await knex("o_setting").insert({ key: "agentUseMode", value: "1" });
    const deps = makeDeps(knex, { "text-vendor": textVendorSource }, {
      createOpenAICompatible: () => ({ chatModel: (modelId: string) => { createdModelIds.push(modelId); return makeLanguageModel(modelId); } }),
    });
    const vendor = createConfiguredVendor(deps);

    const invoked = await vendor.invokeText({
      target: { kind: "logical", key: "scriptAgent" },
      think: false,
      thinkLevel: 2,
      input: { prompt: "hi" },
    });
    assert.equal(invoked.text, "hello");
    assert.equal(createdModelIds[0], "text-model|false|2");

    const streamed = await vendor.streamText({ target: { kind: "logical", key: "scriptAgent" }, input: { prompt: "hi" } });
    let text = "";
    for await (const chunk of streamed.textStream) text += chunk;
    assert.equal(text, "hello");
    assert.equal(createdModelIds[1], "text-model|true|0");
  } finally {
    await knex.destroy();
  }
});

test("validates the configured surface before traffic", async () => {
  const knex = await createKnex();
  try {
    await knex("o_vendorConfig").insert([
      { id: "image-vendor", inputValues: "{}", models: "[]", enable: 1 },
      { id: "video-vendor", inputValues: "{}", models: "[]", enable: 0 },
      { id: "required-input-vendor", inputValues: JSON.stringify({ apiKey: "filled" }), models: "[]", enable: 1 },
      { id: "text-vendor", inputValues: "{}", models: "[]", enable: 0 },
    ]);
    await knex("o_agentDeploy").insert({ key: "scriptAgent", modelName: "text-vendor:text-model" });

    const sources = {
      "image-vendor": imageVendorSource,
      "video-vendor": videoVendorSource,
      "required-input-vendor": requiredInputVendorSource,
      "text-vendor": textVendorSource,
    };
    const vendor = createConfiguredVendor(makeDeps(knex, sources));

    const result = await vendor.validateStartup();
    assert.deepEqual(result.vendorIds, ["image-vendor", "required-input-vendor", "text-vendor", "video-vendor"]);
    assert.equal(result.modelCount, 4);
    assert.equal(result.textBindingCount, 1);
  } finally {
    await knex.destroy();
  }
});

test("startup validation fails on a missing request export", async () => {
  const knex = await createKnex();
  try {
    await knex("o_vendorConfig").insert({ id: "missing-request-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const vendor = createConfiguredVendor(makeDeps(knex, { "missing-request-vendor": missingRequestVendorSource }));

    await assert.rejects(() => vendor.validateStartup(), /未找到供应商配置中的函数 imageRequest/);
  } finally {
    await knex.destroy();
  }
});

test("startup validation fails when an enabled vendor lacks a required input", async () => {
  const knex = await createKnex();
  try {
    await knex("o_vendorConfig").insert({ id: "required-input-vendor", inputValues: JSON.stringify({ apiKey: "" }), models: "[]", enable: 1 });
    const vendor = createConfiguredVendor(makeDeps(knex, { "required-input-vendor": requiredInputVendorSource }));

    await assert.rejects(() => vendor.validateStartup(), /缺少必填配置/);
  } finally {
    await knex.destroy();
  }
});

test("startup validation fails when a bound Agent Text Model is not a text Model", async () => {
  const knex = await createKnex();
  try {
    await knex("o_vendorConfig").insert({ id: "image-vendor", inputValues: "{}", models: "[]", enable: 0 });
    await knex("o_agentDeploy").insert({ key: "scriptAgent", modelName: "image-vendor:image-model" });
    const vendor = createConfiguredVendor(makeDeps(knex, { "image-vendor": imageVendorSource }));

    await assert.rejects(() => vendor.validateStartup(), /不是 text 模型/);
  } finally {
    await knex.destroy();
  }
});

test("applies a typed configuration command and validates before persisting", async () => {
  const knex = await createKnex();
  try {
    await knex("o_vendorConfig").insert({ id: "config-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const vendor = createConfiguredVendor(makeDeps(knex, { "config-vendor": configVendorSource }));

    const configured = await vendor.configure({
      kind: "set-vendor-config",
      vendorId: "config-vendor",
      inputValues: { apiKey: "configured-key" },
      customModels: [{ modelName: "built-in", name: "Custom", type: "text", think: true }],
    });
    assert.deepEqual(configured, { kind: "set-vendor-config", vendorId: "config-vendor" });

    const row = await knex("o_vendorConfig").where("id", "config-vendor").first();
    assert.equal(JSON.parse(row.inputValues).apiKey, "configured-key");
    assert.equal(JSON.parse(row.models)[0].name, "Custom");
  } finally {
    await knex.destroy();
  }
});
