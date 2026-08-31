import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import axios from "axios";
import knexFactory, { type Knex } from "knex";

import type { ImageGenerationInput } from "../src/vendor/contract";
import { createConfiguredVendor, type ConfiguredVendorDependencies } from "../src/vendor";
import { VideoPromptProfileRegistry } from "../src/video/promptProfile";
import { applyLegacyImageReferenceConversion, normalizeHttpResult } from "../src/utils/imageGeneration";

const promptProfiles = VideoPromptProfileRegistry.load(path.join(process.cwd(), "data", "promptProfiles", "video"));

const imageInput: ImageGenerationInput = {
  prompt: "draw",
  referenceList: [{ type: "image", base64: "AAAA" }],
  size: "1K",
  aspectRatio: "16:9",
};

test("legacy reference conversion maps referenceList to imageBase64 below version 2.0", () => {
  const result = applyLegacyImageReferenceConversion("1.5", imageInput) as ImageGenerationInput & { imageBase64: string[] };

  assert.deepEqual(result.imageBase64, ["AAAA"]);
  assert.deepEqual(result.referenceList, [{ type: "image", base64: "AAAA" }]);
});

test("legacy reference conversion keeps referenceList for version 2.0 and above", () => {
  const result = applyLegacyImageReferenceConversion("2.0", imageInput);

  assert.strictEqual(result, imageInput);
  assert.equal((result as ImageGenerationInput & { imageBase64?: string[] }).imageBase64, undefined);
});

test("legacy reference conversion treats missing or non-numeric versions as legacy", () => {
  for (const version of [undefined, "", "abc"]) {
    const result = applyLegacyImageReferenceConversion(version, imageInput) as ImageGenerationInput & {
      imageBase64: string[];
    };
    assert.deepEqual(result.imageBase64, ["AAAA"]);
  }
});

test("normalizes an http result to base64 through a mock download", async (t) => {
  t.mock.method(axios, "get", async () => ({ data: Buffer.from("hello") }));

  assert.equal(await normalizeHttpResult("http://example.com/image.png"), "aGVsbG8=");
});

test("passes non-http results through without downloading", async (t) => {
  const get = t.mock.method(axios, "get", async () => ({ data: Buffer.from("unused") }));

  assert.equal(await normalizeHttpResult("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  assert.equal(get.mock.callCount(), 0);
});

const legacyImageVendorSource = `
const vendor = {
  id: "legacy-image-vendor",
  version: "1.5",
  inputValues: {},
  models: [{ name: "Legacy Image", modelName: "legacy-image", type: "image" }],
};
const imageRequest = (input, model) => Promise.resolve(JSON.stringify({ base64s: input.imageBase64, model: model.modelName }));
exports.vendor = vendor;
exports.imageRequest = imageRequest;
export {};
`;

async function createKnex(): Promise<Knex> {
  const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await knex.schema.createTable("o_vendorConfig", (table) => {
    table.string("id").primary();
    table.text("inputValues");
    table.text("models");
    table.integer("enable");
  });
  return knex;
}

function makeDeps(knex: Knex): ConfiguredVendorDependencies {
  return {
    work: async (operation) => operation(knex),
    readVendorSource: () => legacyImageVendorSource,
    writeVendorSource: () => {},
    deleteVendorSource: () => {},
    promptProfiles,
  };
}

test("legacy reference conversion flows through generateImage to a mock adapter", async () => {
  const knex = await createKnex();
  try {
    await knex("o_vendorConfig").insert({ id: "legacy-image-vendor", inputValues: "{}", models: "[]", enable: 0 });
    const vendor = createConfiguredVendor(makeDeps(knex));

    const input = applyLegacyImageReferenceConversion("1.5", imageInput);
    const result = await vendor.generateImage({
      target: { vendorId: "legacy-image-vendor", modelId: "legacy-image" },
      input,
    });

    assert.equal(result, JSON.stringify({ base64s: ["AAAA"], model: "legacy-image" }));
  } finally {
    await knex.destroy();
  }
});
