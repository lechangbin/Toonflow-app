import assert from "node:assert/strict";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import { createConfiguredVendor, type ConfiguredVendorDependencies } from "../src/vendor";
import { VendorConfigConflictError, VendorConfigNotFoundError } from "../src/vendor/errors";

const textVendorSource = `
const vendor = {
  id: "text-vendor",
  inputValues: {},
  models: [{ name: "Text Model", modelName: "text-model", type: "text", think: false }],
};
const textRequest = (model, think, thinkLevel) => ({});
exports.vendor = vendor;
exports.textRequest = textRequest;
export {};
`;

const imageVendorSource = `
const vendor = {
  id: "image-vendor",
  inputValues: {},
  models: [{ name: "Image Model", modelName: "img", type: "image" }],
};
const imageRequest = (input, model) => Promise.resolve("ok");
exports.vendor = vendor;
exports.imageRequest = imageRequest;
export {};
`;

const requiredInputVendorSource = `
const vendor = {
  id: "req-vendor",
  inputValues: { apiKey: "" },
  inputs: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
  models: [{ name: "Image Model", modelName: "img", type: "image" }],
};
const imageRequest = (input, model) => Promise.resolve("ok");
exports.vendor = vendor;
exports.imageRequest = imageRequest;
export {};
`;

const customVendorSource = `
const vendor = {
  id: "custom-vendor",
  name: "Custom Vendor",
  inputValues: {},
  models: [{ name: "Text Model", modelName: "text-model", type: "text", think: false }],
};
const textRequest = (model, think, thinkLevel) => ({});
exports.vendor = vendor;
exports.textRequest = textRequest;
export {};
`;

const badColonVendorSource = `
const vendor = {
  id: "bad:id",
  inputValues: {},
  models: [{ name: "Text Model", modelName: "text-model", type: "text", think: false }],
};
const textRequest = (model, think, thinkLevel) => ({});
exports.vendor = vendor;
exports.textRequest = textRequest;
export {};
`;

interface TestDeps {
  deps: ConfiguredVendorDependencies;
  store: Map<string, string>;
}

function makeDeps(knex: Knex, sources: Record<string, string>, opts: { failWork?: boolean } = {}): TestDeps {
  const store = new Map<string, string>(Object.entries(sources));
  const deps: ConfiguredVendorDependencies = {
    work: async (operation) => {
      if (opts.failWork) throw new Error("db unavailable");
      return operation(knex);
    },
    readVendorSource: (vendorId) => {
      const source = store.get(vendorId);
      if (source === undefined) throw new Error(`未找到供应商配置文件 ${vendorId}.ts`);
      return source;
    },
    writeVendorSource: (vendorId, source) => {
      store.set(vendorId, source);
    },
    deleteVendorSource: (vendorId) => {
      store.delete(vendorId);
    },
    promptProfiles: {
      get: () => {
        throw new Error("unexpected prompt profile access");
      },
    },
  };
  return { deps, store };
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
    table.increments("id").primary();
    table.string("key");
    table.string("model");
    table.string("modelName");
    table.string("vendorId");
    table.string("name");
    table.string("desc");
    table.integer("temperature");
    table.integer("maxOutputTokens");
  });
  await knex.schema.createTable("o_setting", (table) => {
    table.string("key").primary();
    table.text("value");
  });
  return knex;
}

test("add validates the candidate source and persists the database row plus source file", async () => {
  const knex = await createKnex();
  const { deps, store } = makeDeps(knex, {});
  try {
    const vendor = createConfiguredVendor(deps);

    const result = await vendor.configure({ kind: "add", source: customVendorSource });
    assert.deepEqual(result, { kind: "add", vendorId: "custom-vendor" });

    const row = await knex("o_vendorConfig").where("id", "custom-vendor").first();
    assert.ok(row);
    assert.equal(row.enable, 0);
    assert.equal(row.models, "[]");
    assert.equal(store.get("custom-vendor"), customVendorSource);
  } finally {
    await knex.destroy();
  }
});

test("add rejects a colon in the derived Vendor id before persisting", async () => {
  const knex = await createKnex();
  const { deps, store } = makeDeps(knex, {});
  try {
    const vendor = createConfiguredVendor(deps);

    await assert.rejects(() => vendor.configure({ kind: "add", source: badColonVendorSource }), /不能包含英文冒号/);
    assert.equal(await knex("o_vendorConfig").where("id", "bad:id").first(), undefined);
    assert.equal(store.has("bad:id"), false);
  } finally {
    await knex.destroy();
  }
});

test("add rejects a reserved built-in Vendor id", async () => {
  const knex = await createKnex();
  const { deps, store } = makeDeps(knex, {});
  try {
    const vendor = createConfiguredVendor(deps);
    const agnesSource = `const vendor = { id: "agnes", inputValues: {}, models: [] };\nexports.vendor = vendor; export {};`;

    await assert.rejects(() => vendor.configure({ kind: "add", source: agnesSource }), VendorConfigConflictError);
    assert.equal(store.has("agnes"), false);
  } finally {
    await knex.destroy();
  }
});

test("add compensates the written source file when the database reports a duplicate", async () => {
  const knex = await createKnex();
  const { deps, store } = makeDeps(knex, {});
  try {
    await knex("o_vendorConfig").insert({ id: "custom-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const vendor = createConfiguredVendor(deps);

    await assert.rejects(() => vendor.configure({ kind: "add", source: customVendorSource }), VendorConfigConflictError);
    assert.equal(store.has("custom-vendor"), false, "the half-written source file must be removed");
  } finally {
    await knex.destroy();
  }
});

test("program-update rejects a missing Vendor and an immutable identity change", async () => {
  const knex = await createKnex();
  const { deps, store } = makeDeps(knex, { "text-vendor": textVendorSource });
  try {
    await knex("o_vendorConfig").insert({ id: "text-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const vendor = createConfiguredVendor(deps);

    await assert.rejects(() => vendor.configure({ kind: "program-update", vendorId: "nope", source: textVendorSource }), VendorConfigNotFoundError);

    const changedSource = textVendorSource.replace("Text Model", "Renamed Model");
    await assert.rejects(
      () => vendor.configure({ kind: "program-update", vendorId: "text-vendor", source: customVendorSource }),
      /Vendor id 不允许在更新时改变/,
    );
    assert.equal(store.get("text-vendor"), textVendorSource, "a rejected update must leave the source untouched");

    const result = await vendor.configure({ kind: "program-update", vendorId: "text-vendor", source: changedSource });
    assert.deepEqual(result, { kind: "program-update", vendorId: "text-vendor" });
    assert.equal(store.get("text-vendor"), changedSource);
  } finally {
    await knex.destroy();
  }
});

test("input-update validates the candidate runtime and persists", async () => {
  const knex = await createKnex();
  const { deps } = makeDeps(knex, { "text-vendor": textVendorSource });
  try {
    await knex("o_vendorConfig").insert({ id: "text-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const vendor = createConfiguredVendor(deps);

    const result = await vendor.configure({ kind: "input-update", vendorId: "text-vendor", inputValues: { apiKey: "k" } });
    assert.deepEqual(result, { kind: "input-update", vendorId: "text-vendor" });
    const row = await knex("o_vendorConfig").where("id", "text-vendor").first();
    assert.equal(JSON.parse(row.inputValues).apiKey, "k");
  } finally {
    await knex.destroy();
  }
});

test("enable-disable validates required inputs and the candidate runtime before enabling", async () => {
  const knex = await createKnex();
  const { deps } = makeDeps(knex, { "req-vendor": requiredInputVendorSource });
  try {
    await knex("o_vendorConfig").insert({ id: "req-vendor", inputValues: JSON.stringify({ apiKey: "" }), models: "[]", enable: 0 });
    const vendor = createConfiguredVendor(deps);

    await assert.rejects(() => vendor.configure({ kind: "enable-disable", vendorId: "req-vendor", enable: true }), /缺少必填配置/);
    let row = await knex("o_vendorConfig").where("id", "req-vendor").first();
    assert.equal(row.enable, 0, "a rejected enable must leave the vendor disabled");

    await vendor.configure({ kind: "input-update", vendorId: "req-vendor", inputValues: { apiKey: "filled" } });
    await vendor.configure({ kind: "enable-disable", vendorId: "req-vendor", enable: true });
    row = await knex("o_vendorConfig").where("id", "req-vendor").first();
    assert.equal(row.enable, 1);

    await vendor.configure({ kind: "enable-disable", vendorId: "req-vendor", enable: false });
    row = await knex("o_vendorConfig").where("id", "req-vendor").first();
    assert.equal(row.enable, 0);
  } finally {
    await knex.destroy();
  }
});

test("input-update on an enabled vendor rejects a candidate missing a required input", async () => {
  const knex = await createKnex();
  const { deps } = makeDeps(knex, { "req-vendor": requiredInputVendorSource });
  try {
    await knex("o_vendorConfig").insert({ id: "req-vendor", inputValues: JSON.stringify({ apiKey: "filled" }), models: "[]", enable: 1 });
    const vendor = createConfiguredVendor(deps);

    await assert.rejects(() => vendor.configure({ kind: "input-update", vendorId: "req-vendor", inputValues: { apiKey: "" } }), /缺少必填配置/);
    const row = await knex("o_vendorConfig").where("id", "req-vendor").first();
    assert.equal(JSON.parse(row.inputValues).apiKey, "filled", "a rejected input-update must leave the prior input intact");
  } finally {
    await knex.destroy();
  }
});

test("custom-model-update validates the final effective model set and persists", async () => {
  const knex = await createKnex();
  const { deps } = makeDeps(knex, { "text-vendor": textVendorSource });
  try {
    await knex("o_vendorConfig").insert({ id: "text-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const vendor = createConfiguredVendor(deps);

    const result = await vendor.configure({
      kind: "custom-model-update",
      vendorId: "text-vendor",
      model: { name: "Extra", modelName: "extra", type: "text", think: false },
    });
    assert.deepEqual(result, { kind: "custom-model-update", vendorId: "text-vendor" });
    let row = await knex("o_vendorConfig").where("id", "text-vendor").first();
    assert.ok(JSON.parse(row.models).some((m: { modelName: string }) => m.modelName === "extra"));

    await assert.rejects(
      () =>
        vendor.configure({
          kind: "custom-model-update",
          vendorId: "text-vendor",
          model: { name: "Broken", modelName: "broken", type: "image" },
        }),
      /imageRequest/,
    );
    row = await knex("o_vendorConfig").where("id", "text-vendor").first();
    assert.equal(JSON.parse(row.models).some((m: { modelName: string }) => m.modelName === "broken"), false);
  } finally {
    await knex.destroy();
  }
});

test("custom-model-remove rejects a built-in model and removes only custom entries", async () => {
  const knex = await createKnex();
  const { deps } = makeDeps(knex, { "text-vendor": textVendorSource });
  try {
    await knex("o_vendorConfig").insert({
      id: "text-vendor",
      inputValues: "{}",
      models: JSON.stringify([{ name: "Extra", modelName: "extra", type: "text", think: false }]),
      enable: 0,
    });
    const vendor = createConfiguredVendor(deps);

    await assert.rejects(() => vendor.configure({ kind: "custom-model-remove", vendorId: "text-vendor", modelName: "text-model" }), /基本模型不允许删除/);

    const result = await vendor.configure({ kind: "custom-model-remove", vendorId: "text-vendor", modelName: "extra" });
    assert.deepEqual(result, { kind: "custom-model-remove", vendorId: "text-vendor" });
    const row = await knex("o_vendorConfig").where("id", "text-vendor").first();
    assert.equal(JSON.parse(row.models).length, 0);
  } finally {
    await knex.destroy();
  }
});

test("delete removes the row, source file, and clears Agent bindings atomically", async () => {
  const knex = await createKnex();
  const { deps, store } = makeDeps(knex, { "text-vendor": textVendorSource });
  try {
    await knex("o_vendorConfig").insert({ id: "text-vendor", inputValues: "{}", models: "[]", enable: 1 });
    const [bindingId] = await knex("o_agentDeploy").insert(
      { key: "scriptAgent", modelName: "text-vendor:text-model", vendorId: "text-vendor" },
      ["id"],
    );
    const vendor = createConfiguredVendor(deps);

    const result = await vendor.configure({ kind: "delete", vendorId: "text-vendor" });
    assert.deepEqual(result, { kind: "delete", vendorId: "text-vendor" });
    assert.equal(await knex("o_vendorConfig").where("id", "text-vendor").first(), undefined);
    assert.equal(store.has("text-vendor"), false);
    const binding = await knex("o_agentDeploy").where("id", bindingId.id).first();
    assert.equal(binding.modelName, null);
  } finally {
    await knex.destroy();
  }
});

test("delete compensates the source file when the database transaction fails", async () => {
  const knex = await createKnex();
  const { deps, store } = makeDeps(knex, { "text-vendor": textVendorSource }, { failWork: true });
  try {
    await knex("o_vendorConfig").insert({ id: "text-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const vendor = createConfiguredVendor(deps);

    await assert.rejects(() => vendor.configure({ kind: "delete", vendorId: "text-vendor" }), /db unavailable/);
    assert.equal(store.get("text-vendor"), textVendorSource, "the source file must be restored after a failed delete");
    assert.ok(await knex("o_vendorConfig").where("id", "text-vendor").first());
  } finally {
    await knex.destroy();
  }
});

test("agent-mode persists the mode", async () => {
  const knex = await createKnex();
  const { deps } = makeDeps(knex, {});
  try {
    await knex("o_setting").insert({ key: "agentUseMode", value: "0" });
    const vendor = createConfiguredVendor(deps);

    const result = await vendor.configure({ kind: "agent-mode", mode: "1" });
    assert.deepEqual(result, { kind: "agent-mode", mode: "1" });
    const row = await knex("o_setting").where("key", "agentUseMode").first();
    assert.equal(row.value, "1");
  } finally {
    await knex.destroy();
  }
});

test("agent-binding resolves to an enabled Text model and persists", async () => {
  const knex = await createKnex();
  const { deps } = makeDeps(knex, { "text-vendor": textVendorSource });
  try {
    await knex("o_vendorConfig").insert({ id: "text-vendor", inputValues: "{}", models: "[]", enable: 1 });
    const [bindingId] = await knex("o_agentDeploy").insert({ key: "scriptAgent", modelName: "" }, ["id"]);
    const vendor = createConfiguredVendor(deps);

    const result = await vendor.configure({
      kind: "agent-binding",
      bindings: [
        { id: bindingId.id, name: "Script", model: "text-model", modelName: "text-vendor:text-model", vendorId: "text-vendor", desc: "" },
      ],
    });
    assert.deepEqual(result, { kind: "agent-binding", count: 1 });
    const binding = await knex("o_agentDeploy").where("id", bindingId.id).first();
    assert.equal(binding.modelName, "text-vendor:text-model");
  } finally {
    await knex.destroy();
  }
});

test("agent-binding rejects a disabled vendor before persisting", async () => {
  const knex = await createKnex();
  const { deps } = makeDeps(knex, { "text-vendor": textVendorSource });
  try {
    await knex("o_vendorConfig").insert({ id: "text-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const [bindingId] = await knex("o_agentDeploy").insert({ key: "scriptAgent", modelName: "" }, ["id"]);
    const vendor = createConfiguredVendor(deps);

    await assert.rejects(
      () =>
        vendor.configure({
          kind: "agent-binding",
          bindings: [
            { id: bindingId.id, name: "Script", model: "text-model", modelName: "text-vendor:text-model", vendorId: "text-vendor", desc: "" },
          ],
        }),
      /未启用/,
    );
    const binding = await knex("o_agentDeploy").where("id", bindingId.id).first();
    assert.equal(binding.modelName, "", "a rejected binding must leave the prior binding intact");
  } finally {
    await knex.destroy();
  }
});

test("agent-binding rejects a non-Text target before persisting", async () => {
  const knex = await createKnex();
  const { deps } = makeDeps(knex, { "image-vendor": imageVendorSource });
  try {
    await knex("o_vendorConfig").insert({ id: "image-vendor", inputValues: "{}", models: "[]", enable: 1 });
    const [bindingId] = await knex("o_agentDeploy").insert({ key: "scriptAgent", modelName: "" }, ["id"]);
    const vendor = createConfiguredVendor(deps);

    await assert.rejects(
      () =>
        vendor.configure({
          kind: "agent-binding",
          bindings: [
            { id: bindingId.id, name: "Script", model: "img", modelName: "image-vendor:img", vendorId: "image-vendor", desc: "" },
          ],
        }),
      /不是 text 模型/,
    );
  } finally {
    await knex.destroy();
  }
});
