import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import knexFactory from "knex";

import { assertT11AgnesTextBinding, bindT11AgnesTextCall, T11_AGNES_TEXT_POLICY,
  T11_AGNES_TEXT_POLICY_REVISION } from "../src/eval/runtimeCorpusModelPolicy";
import type { ConfiguredTextCall } from "../src/vendor/contract";
import initDB from "../src/lib/initDB";
import { createConfiguredVendor } from "../src/vendor";
import { VideoPromptProfileRegistry } from "../src/video/promptProfile";

test("T11 real Text binding must match frozen Agnes target and tuning", () => {
  assertT11AgnesTextBinding(T11_AGNES_TEXT_POLICY);
  assert.match(T11_AGNES_TEXT_POLICY_REVISION, /^[a-f0-9]{64}$/u);
  for (const changed of [{ modelId: "another-model" }, { temperature: 1 },
    { maxOutputTokens: 1024 }, { contextWindowTokens: 128_000 },
    { vendorId: "another-vendor" }]) {
    assert.throws(() => assertT11AgnesTextBinding({ ...T11_AGNES_TEXT_POLICY,
      ...changed }), /differs from frozen policy/u);
  }
  let stoppedBy: unknown;
  const wrapped = bindT11AgnesTextCall({ target: T11_AGNES_TEXT_POLICY,
    invokeText: (input) => { stoppedBy = input.stopWhen;
      return {} as ReturnType<ConfiguredTextCall["invokeText"]>; } });
  wrapped.invokeText({ prompt: "test", stopWhen: undefined });
  assert.equal(typeof stoppedBy, "function");
});

test("T11 policy reads the actual configured Script and Production Agnes bindings", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const oldLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = oldLog; }
    await db("o_vendorConfig").where({ id: "agnes" }).update({
      inputValues: JSON.stringify({ apiKey: "sk-test-model-policy", baseUrl: "https://apihub.agnes-ai.com" }),
      enable: 1 });
    for (const key of ["scriptAgent:decisionAgent", "productionAgent:decisionAgent"]) {
      await db("o_agentDeploy").where({ key }).update({ model: "agnes-3.0-flash",
        modelName: "agnes:agnes-3.0-flash", vendorId: "agnes",
        temperature: 0, maxOutputTokens: 512 });
    }
    await db("o_setting").insert({ key: "agentUseMode", value: "1" });
    const vendor = createConfiguredVendor({ work: async (operation) => operation(db),
      readVendorSource: () => readFileSync(path.resolve("data/vendor/agnes.ts"), "utf8"),
      writeVendorSource: () => { throw new Error("test cannot write Vendor source"); },
      deleteVendorSource: () => { throw new Error("test cannot delete Vendor source"); },
      promptProfiles: VideoPromptProfileRegistry.load(path.resolve("data/promptProfiles/video")) });
    for (const key of ["scriptAgent:decisionAgent", "productionAgent:decisionAgent"] as const) {
      const call = await vendor.openTextCall({ kind: "logical", key });
      assertT11AgnesTextBinding(call.target);
    }
    await db("o_agentDeploy").where({ key: "productionAgent:decisionAgent" })
      .update({ temperature: 1 });
    const drifted = await vendor.openTextCall({ kind: "logical",
      key: "productionAgent:decisionAgent" });
    assert.throws(() => assertT11AgnesTextBinding(drifted.target), /temperature/u);
  } finally { await db.destroy(); }
});
