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
  "routes/script/extractAssets.ts",
  "routes/script/getAiRegex.ts",
  "utils/cleanNovel.ts",
  "routes/artStyle/extractStylePrompt.ts",
  "routes/assetsGenerate/batchPolishAssetsPrompt.ts",
  "routes/assetsGenerate/polishAssetsPrompt.ts",
  "routes/cornerScape/batchBindAudio.ts",
  "routes/production/assets/batchGenerateAssetsImage.ts",
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

  const memory = new Memory("productionAgent", "iso-key", fakeVendor);
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
