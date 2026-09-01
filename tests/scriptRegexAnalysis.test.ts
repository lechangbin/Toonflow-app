import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { normalizeAiRegex, resolveRegexAnalysisTarget } from "../src/script/regexAnalysis";

test("normalizes fenced AI output into a reusable global regular expression", () => {
  assert.equal(
    normalizeAiRegex("```regex\n/第\\s*([0-9]+)\\s*集\\s*([^\\n\\r]*)/\n```"),
    "/第\\s*([0-9]+)\\s*集\\s*([^\\n\\r]*)/g",
  );
  assert.throws(() => normalizeAiRegex("这里没有正则"), /未返回有效的正则表达式/);
});

test("uses an explicit logical binding before considering enabled-model fallback", async () => {
  const database = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await database.schema.createTable("o_agentDeploy", (table) => {
      table.string("key");
      table.string("modelName");
    });
    await database("o_agentDeploy").insert({ key: "universalAi", modelName: "chosen:text-model" });
    const target = await resolveRegexAnalysisTarget(database, {
      listVendors: async () => [],
      inspectVendor: async () => { throw new Error("fallback must not be inspected"); },
    });
    assert.deepEqual(target, { kind: "direct", vendorId: "chosen", modelId: "text-model" });
  } finally {
    await database.destroy();
  }
});

test("falls back deterministically to an enabled text-specialist vendor when bindings are empty", async () => {
  const database = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await database.schema.createTable("o_agentDeploy", (table) => {
      table.string("key");
      table.string("modelName");
    });
    await database("o_agentDeploy").insert([
      { key: "universalAi", modelName: "" },
      { key: "scriptAgent", modelName: "" },
    ]);
    const target = await resolveRegexAnalysisTarget(database, {
      listVendors: async () => [
        { vendorId: "multimodal", name: "Multi", enabled: true, modelTypes: ["text", "image"] },
        { vendorId: "text-only", name: "Text", enabled: true, modelTypes: ["text"] },
      ],
      inspectVendor: async (vendorId) => ({
        vendorId,
        name: vendorId,
        inputs: [],
        models: [{ type: "text", name: "Fast", modelName: "fast-model", think: false }],
      }),
    });
    assert.deepEqual(target, { kind: "direct", vendorId: "text-only", modelId: "fast-model" });
  } finally {
    await database.destroy();
  }
});
