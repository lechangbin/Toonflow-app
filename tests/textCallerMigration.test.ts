import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import Memory from "../src/utils/agent/memory";
import type { ConfiguredVendor } from "../src/vendor";

const SRC_ROOT = path.join(process.cwd(), "src");

/**
 * Text callers migrated in #20. Each one must no longer import the old
 * programmable-Vendor helpers and must depend on the configured Vendor module.
 * `src/video/promptGeneration.ts` still lists Video Models through the legacy
 * `u.vendor` helper; that call is Video (#21/#22) territory, not Text.
 */
const migratedTextCallers = [
  "agents/scriptAgent/index.ts",
  "agents/productionAgent/index.ts",
  "utils/agent/memory.ts",
  "video/promptGeneration.ts",
  // routes/script/extractAssets.ts 已在 #41 迁移为纯薄适配器，不再接触
  // Text/Vendor；模型编排由 src/script/baseAssetExtraction.ts 拥有，见下方
  // base-asset extraction delegation 守卫与 tests/baseAssetExtraction.test.ts。
  "routes/script/getAiRegex.ts",
  "utils/cleanNovel.ts",
  "routes/artStyle/extractStylePrompt.ts",
  "routes/cornerScape/batchBindAudio.ts",
  // routes/production/assets/batchGenerateAssetsImage.ts 已在 #37 迁移为纯薄适配器，
  // 不再接触 Text/Vendor，由 tests/derivedAssetGeneration.test.ts 的静态守卫覆盖。
  "routes/setting/agentDeploy/agentSetKey.ts",
  "routes/setting/vendorConfig/modelTest/textTest.ts",
  "routes/setting/vendorConfig/modelTest.ts",
];

function readSource(relative: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relative), "utf8");
}

test("migrated Text callers no longer use the old ai/vendor helpers", () => {
  for (const relative of migratedTextCallers) {
    const source = readSource(relative);
    assert.ok(!source.includes("u.Ai.Text"), `${relative} 仍调用 u.Ai.Text`);
    assert.ok(!source.includes('from "@/utils/ai"'), `${relative} 仍加载旧 ai 模块`);
    assert.ok(!source.includes('from "@/utils/vendor"'), `${relative} 仍加载旧 vendor 模块`);
    assert.ok(source.includes('from "@/vendor"'), `${relative} 未依赖 configured Vendor 模块`);
    assert.ok(source.includes("getDefaultConfiguredVendor"), `${relative} 未使用 getDefaultConfiguredVendor`);
  }
});

test("asset prompt routes delegate Text calls to the orchestration module", () => {
  // Issue #33：路由是薄适配器，模型调用、模板加载、校验与失效都在共享模块内
  const orchestration = readSource("assets/assetPromptOrchestration.ts");
  assert.ok(orchestration.includes('from "@/vendor"'), 'orchestration 未依赖 configured Vendor 模块');
  assert.ok(orchestration.includes("getDefaultConfiguredVendor"), "orchestration 未使用 getDefaultConfiguredVendor");
  const assetPromptRoutes = ["routes/assetsGenerate/batchPolishAssetsPrompt.ts", "routes/assetsGenerate/polishAssetsPrompt.ts"];
  for (const relative of assetPromptRoutes) {
    const source = readSource(relative);
    assert.ok(!source.includes("u.Ai.Text"), relative + " 仍调用 u.Ai.Text");
    assert.ok(!source.includes('from "@/utils/ai"'), relative + " 仍加载旧 ai 模块");
    assert.ok(!source.includes('from "@/utils/vendor"'), relative + " 仍加载旧 vendor 模块");
    assert.ok(!source.includes("invokeText"), relative + " 不应直接调用 Text 模型");
    assert.ok(
      source.includes('from "@/assets/assetPromptOrchestration"'),
      relative + " 未委托 orchestration 模块",
    );
  }
});

test("script asset extraction delegates Text calls to the base-asset orchestration module", () => {
  // Issue #41：路由是薄适配器，双阶段模型编排由深模块拥有
  const orchestration = readSource("script/baseAssetExtraction.ts");
  assert.ok(orchestration.includes('from "@/vendor"'), 'orchestration 未依赖 configured Vendor 模块');
  assert.ok(orchestration.includes("getDefaultConfiguredVendor"), "orchestration 未使用 getDefaultConfiguredVendor");
  assert.ok(orchestration.includes("openTextCall"), "orchestration 未使用一次性解析的 openTextCall");

  const source = readSource("routes/script/extractAssets.ts");
  assert.ok(!source.includes("u.Ai.Text"), "extractAssets 仍调用 u.Ai.Text");
  assert.ok(!source.includes('from "@/utils/ai"'), "extractAssets 仍加载旧 ai 模块");
  assert.ok(!source.includes('from "@/utils/vendor"'), "extractAssets 仍加载旧 vendor 模块");
  assert.ok(!source.includes("invokeText"), "extractAssets 不应直接调用 Text 模型");
  assert.ok(
    source.includes('from "@/script/baseAssetExtraction"'),
    "extractAssets 未委托 base-asset orchestration 模块",
  );
});

test("the only remaining legacy Text entry points are gone from source", () => {
  const files = migratedTextCallers.map(readSource).join("\n");
  assert.ok(!files.includes("u.Ai.Text("), "仍有 u.Ai.Text( 旧路径残留");
});

test("Agent Memory compresses and retrieves through the configured logical target", async () => {
  const calls: any[] = [];
  const fakeVendor = {
    invokeText: async (request: any) => {
      calls.push(request);
      return { text: '["a","c"]' };
    },
  } as unknown as Pick<ConfiguredVendor, "invokeText">;

  const memory = new Memory(
    "productionAgent",
    "iso-key",
    fakeVendor,
    async () => '你是一个信息检索助手。只返回相关摘要的id列表。',
  );
  const ids = await memory.judgeSummaryRelevance("关键词", [
    { id: "a", content: "alpha" },
    { id: "b", content: "beta" },
    { id: "c", content: "gamma" },
  ]);

  assert.deepEqual(ids, ["a", "c"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].target, { kind: "logical", key: "productionAgent" });
  assert.ok(String(calls[0].input.system).includes("信息检索"));
  assert.equal(calls[0].input.messages.length, 1);
  assert.ok(String(calls[0].input.messages[0].content).includes("关键词"));
});

test("Script Agent and Production Agent stream through the configured logical targets", () => {
  const scriptAgent = readSource("agents/scriptAgent/index.ts");
  const productionAgent = readSource("agents/productionAgent/index.ts");

  for (const source of [scriptAgent, productionAgent]) {
    assert.ok(source.includes(".streamText({"), "Agent 未使用 streamText");
    assert.ok(source.includes('kind: "logical"'), "Agent 未使用 logical 目标");
  }

  assert.ok(scriptAgent.includes('key: "scriptAgent:decisionAgent"'));
  assert.ok(productionAgent.includes('key: "productionAgent:decisionAgent"'));
});
