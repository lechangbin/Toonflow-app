import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { transform } from "sucrase";

import runCode from "../src/utils/vm";

const source = fs.readFileSync(path.join(process.cwd(), "data/vendor/deepseek.ts"), "utf8");
const compiled = transform(source, { transforms: ["typescript"] }).code;

test("DeepSeek adapter exposes the official V4 text models and thinking request fields", async () => {
  let providerOptions: any;
  let outgoingBody: any;
  const adapter = runCode(compiled, undefined, {
    createOpenAICompatible: (options: any) => {
      providerOptions = options;
      return { chatModel: (modelName: string) => ({ modelName }) };
    },
    fetch: async (_url: string, options: any) => {
      outgoingBody = JSON.parse(options.body);
      return { ok: true };
    },
  });
  Object.assign(adapter.vendor.inputValues, {
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.invalid/v1",
  });

  assert.deepEqual(
    adapter.vendor.models.map((model: any) => model.modelName),
    ["deepseek-v4-pro", "deepseek-v4-flash"],
  );
  const model = adapter.vendor.models.find((item: any) => item.modelName === "deepseek-v4-flash");
  assert.deepEqual(adapter.textRequest(model, true, 3), { modelName: "deepseek-v4-flash" });

  await providerOptions.fetch("https://api.deepseek.invalid/v1/chat/completions", {
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  });

  assert.equal(providerOptions.baseURL, "https://api.deepseek.invalid/v1");
  assert.deepEqual(outgoingBody.thinking, { type: "enabled" });
  assert.equal(outgoingBody.reasoning_effort, "max");
});
