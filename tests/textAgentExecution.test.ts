import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";
import { Output, tool, jsonSchema } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { z } from "zod";

import { VideoPromptProfileRegistry } from "../src/video/promptProfile";
import { createConfiguredVendor, type ConfiguredVendorDependencies } from "../src/vendor";

const promptProfiles = VideoPromptProfileRegistry.load(path.join(process.cwd(), "data", "promptProfiles", "video"));

const cannedUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/**
 * A text Vendor whose `textRequest` encodes the resolved `think`/`thinkLevel`
 * into the model id, so callers can observe that the configured vendor forwards
 * them. The actual language model is injected through `createOpenAICompatible`.
 */
const textVendorSource = `
const vendor = {
  id: "text-vendor",
  inputValues: {},
  models: [{ name: "Text Model", modelName: "text-model", type: "text", think: false }],
};
const textRequest = (model, think, thinkLevel) =>
  createOpenAICompatible({ name: "mock" }).chatModel(model.modelName + "|" + think + "|" + thinkLevel);
exports.vendor = vendor;
exports.textRequest = textRequest;
export {};
`;

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

function makeDeps(
  knex: Knex,
  sources: Record<string, string>,
  onModel?: (model: MockLanguageModelV3) => void,
): ConfiguredVendorDependencies {
  return {
    work: async (operation) => operation(knex),
    readVendorSource: (vendorId) => {
      const source = sources[vendorId];
      if (!source) throw new Error(`未找到供应商配置文件 ${vendorId}.ts`);
      return source;
    },
    writeVendorSource: () => {},
    deleteVendorSource: () => {},
    promptProfiles,
    dependencyOverrides: {
      createOpenAICompatible: () => ({
        chatModel: (modelId: string) => {
          const model = makeLanguageModel(modelId);
          onModel?.(model);
          return model;
        },
      }),
    },
  };
}

/** Seeds a simple/advanced logical binding for `text-vendor:text-model`. */
async function seedLogicalBinding(knex: Knex, options: { temperature?: number; maxOutputTokens?: number } = {}) {
  await knex("o_vendorConfig").insert({ id: "text-vendor", inputValues: "{}", models: "[]", enable: 0 });
  await knex("o_agentDeploy").insert({
    key: "scriptAgent",
    modelName: "text-vendor:text-model",
    temperature: options.temperature ?? null,
    maxOutputTokens: options.maxOutputTokens ?? null,
  });
  await knex("o_setting").insert({ key: "agentUseMode", value: "1" });
}

test("forwards resolved temperature and maxOutputTokens to the model", async () => {
  const knex = await createKnex();
  const created: MockLanguageModelV3[] = [];
  try {
    await seedLogicalBinding(knex, { temperature: 7, maxOutputTokens: 2048 });
    const vendor = createConfiguredVendor(makeDeps(knex, { "text-vendor": textVendorSource }, (m) => created.push(m)));

    await vendor.invokeText({ target: { kind: "logical", key: "scriptAgent" }, input: { prompt: "hi" } });
    assert.equal(created[0].doGenerateCalls[0].temperature, 7);
    assert.equal(created[0].doGenerateCalls[0].maxOutputTokens, 2048);

    const streamed = await vendor.streamText({ target: { kind: "logical", key: "scriptAgent" }, input: { prompt: "hi" } });
    for await (const _chunk of streamed.textStream) void _chunk;
    assert.equal(created[1].doStreamCalls[0].temperature, 7);
    assert.equal(created[1].doStreamCalls[0].maxOutputTokens, 2048);
  } finally {
    await knex.destroy();
  }
});

test("forwards think and thinkLevel to the text binding with model defaults", async () => {
  const knex = await createKnex();
  const created: MockLanguageModelV3[] = [];
  try {
    await seedLogicalBinding(knex);
    const vendor = createConfiguredVendor(makeDeps(knex, { "text-vendor": textVendorSource }, (m) => created.push(m)));

    await vendor.invokeText({
      target: { kind: "logical", key: "scriptAgent" },
      think: true,
      thinkLevel: 2,
      input: { prompt: "hi" },
    });
    assert.equal(created[0].modelId, "text-model|true|2");

    // Omitting think falls back to the model's own `think` flag (false).
    const streamed = await vendor.streamText({ target: { kind: "logical", key: "scriptAgent" }, input: { prompt: "hi" } });
    for await (const _chunk of streamed.textStream) void _chunk;
    assert.equal(created[1].modelId, "text-model|false|0");
  } finally {
    await knex.destroy();
  }
});

test("extracts reasoning through the reasoning middleware on the stream path", async () => {
  const knex = await createKnex();
  const created: MockLanguageModelV3[] = [];
  try {
    await seedLogicalBinding(knex);
    // The vendor emits a single text delta carrying a reasoning tag; the
    // configured stream must split it into reasoning parts.
    const reasoningModel = new MockLanguageModelV3({
      modelId: "text-model|false|0",
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "<reasoning_content>thinking step</reasoning_content>the answer" },
          { type: "text-end", id: "t1" },
          { type: "finish", usage: cannedUsage, finishReason: { unified: "stop" as const, raw: "stop" } },
        ]),
      }),
    });
    const vendor = createConfiguredVendor({
      work: async (operation) => operation(knex),
      readVendorSource: () => textVendorSource,
      writeVendorSource: () => {},
      deleteVendorSource: () => {},
      promptProfiles,
      dependencyOverrides: {
        createOpenAICompatible: () => ({ chatModel: () => reasoningModel }),
      },
    });

    const { fullStream } = await vendor.streamText({ target: { kind: "logical", key: "scriptAgent" }, input: { prompt: "go" } });
    const parts: { type: string; text?: string }[] = [];
    for await (const chunk of fullStream) {
      parts.push({ type: chunk.type, text: (chunk as { text?: string }).text });
    }

    assert.ok(parts.some((p) => p.type === "reasoning-start"));
    assert.ok(parts.some((p) => p.type === "reasoning-delta" && p.text === "thinking step"));
    assert.ok(parts.some((p) => p.type === "reasoning-end"));
    assert.ok(parts.some((p) => p.type === "text-delta" && p.text === "the answer"));
  } finally {
    await knex.destroy();
  }
});

test("wires the development middleware without breaking text generation", async () => {
  const knex = await createKnex();
  const created: MockLanguageModelV3[] = [];
  // Isolate the devtools on-disk bookkeeping from the repository.
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-devtools-"));
  process.chdir(tmp);
  try {
    await seedLogicalBinding(knex);
    await knex("o_setting").insert({ key: "switchAiDevTool", value: "1" });
    const vendor = createConfiguredVendor(makeDeps(knex, { "text-vendor": textVendorSource }, (m) => created.push(m)));

    const invoked = await vendor.invokeText({ target: { kind: "logical", key: "scriptAgent" }, input: { prompt: "hi" } });
    assert.equal(invoked.text, "hello");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
    await knex.destroy();
  }
});

test("forwards tools and bounds tool loops via stepCountIs stopping", async () => {
  const knex = await createKnex();
  const created: MockLanguageModelV3[] = [];
  try {
    await knex("o_vendorConfig").insert({ id: "text-vendor", inputValues: "{}", models: "[]", enable: 0 });
    // A model that only ever requests the same tool, so the step limit is the
    // only thing that terminates the loop.
    let calls = 0;
    const loopingModel = new MockLanguageModelV3({
      modelId: "looper",
      doGenerate: async () => {
        calls++;
        return {
          content: [{ type: "tool-call" as const, toolCallId: `call-${calls}`, toolName: "noop", input: "{}" }],
          finishReason: { unified: "tool-calls" as const, raw: "tool-calls" },
          usage: cannedUsage,
          warnings: [],
        };
      },
    });
    const vendor = createConfiguredVendor({
      work: async (operation) => operation(knex),
      readVendorSource: () => textVendorSource,
      writeVendorSource: () => {},
      deleteVendorSource: () => {},
      promptProfiles,
      dependencyOverrides: {
        createOpenAICompatible: () => ({ chatModel: () => loopingModel }),
      },
    });

    const noopTool = tool({
      description: "noop",
      inputSchema: jsonSchema(z.object({ x: z.number().optional() }).toJSONSchema()),
      execute: async () => "ok",
    });

    await vendor.invokeText({
      target: { kind: "direct", vendorId: "text-vendor", modelId: "text-model" },
      input: { prompt: "go", tools: { noop: noopTool } },
    });

    // One tool -> stepCountIs(1 * 50). The loop must terminate exactly there.
    assert.equal(calls, 50);
    assert.equal(loopingModel.doGenerateCalls[0].tools?.length, 1);
  } finally {
    await knex.destroy();
  }
});

test("invokeText with Output.object returns the structured output used by Prompt Revision", async () => {
  const knex = await createKnex();
  try {
    await knex("o_vendorConfig").insert({ id: "text-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const structuredModel = new MockLanguageModelV3({
      modelId: "structured",
      doGenerate: async () => ({
        content: [{ type: "text" as const, text: '{"subject":"A lantern","motion":"Sways"}' }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: cannedUsage,
        warnings: [],
      }),
    });
    const vendor = createConfiguredVendor({
      work: async (operation) => operation(knex),
      readVendorSource: () => textVendorSource,
      writeVendorSource: () => {},
      deleteVendorSource: () => {},
      promptProfiles,
      dependencyOverrides: {
        createOpenAICompatible: () => ({ chatModel: () => structuredModel }),
      },
    });

    const schema = z.object({ subject: z.string(), motion: z.string().optional() });
    const result = await vendor.invokeText({
      target: { kind: "direct", vendorId: "text-vendor", modelId: "text-model" },
      input: { prompt: "go", output: Output.object({ schema, name: "video_prompt_draft" }) },
    });

    assert.equal(result.output.subject, "A lantern");
    assert.equal(result.output.motion, "Sways");
  } finally {
    await knex.destroy();
  }
});

test("invokes and streams direct text targets", async () => {
  const knex = await createKnex();
  const created: MockLanguageModelV3[] = [];
  try {
    await knex("o_vendorConfig").insert({ id: "text-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const vendor = createConfiguredVendor(makeDeps(knex, { "text-vendor": textVendorSource }, (m) => created.push(m)));

    const invoked = await vendor.invokeText({
      target: { kind: "direct", vendorId: "text-vendor", modelId: "text-model" },
      input: { prompt: "hi" },
    });
    assert.equal(invoked.text, "hello");

    const streamed = await vendor.streamText({
      target: { kind: "direct", vendorId: "text-vendor", modelId: "text-model" },
      input: { prompt: "hi" },
    });
    let text = "";
    for await (const chunk of streamed.textStream) text += chunk;
    assert.equal(text, "hello");
  } finally {
    await knex.destroy();
  }
});
