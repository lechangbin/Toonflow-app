import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import type { ResolvedAssetGenerationInput } from "../src/assets/assetPromptOrchestration";
import { createBillableImagePreflight, BillableImagePreflightError } from "../src/controlledTools/billableImagePreflight";

const scope = { projectId: 7, assetId: 10, vendorId: "vendor", modelId: "model", resolution: "1K",
  maxCalls: 1 as const, estimatedMaxCostMicros: 200_000, currency: "USD" };
const png = Buffer.from("89504e470d0a1a0a", "hex");

function entry(): ResolvedAssetGenerationInput {
  return { assetsId: 10, assetRawType: "role", briefType: "character", name: "角色",
    generationPrompt: "一位角色", promptRevision: { skillVersion: "v1", templateHash: "t", contextHash: "c", referenceHash: "r" },
    references: [{ id: 4, projectId: 7, assetsId: 10, mediaPath: "/ref.png", mediaMime: "image/png",
      orderIndex: 0, description: "衣装", descriptionSource: "human", analysisState: "ready",
      visualRole: "wardrobe", requiredTransfers: [], exclusions: [], createTime: 1, updateTime: 1 }],
    selectedReferenceIds: [4] };
}

test("preflight binds configured target, fresh prompt and actual reference bytes without storing them", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.schema.createTable("o_project", (t) => { t.integer("id"); t.text("imageModel"); t.text("imageQuality"); });
    await db.schema.createTable("o_assets", (t) => { t.integer("id"); t.integer("projectId"); t.integer("scriptId");
      t.integer("assetsId"); t.text("type"); t.text("name"); t.text("describe"); t.integer("imageId"); });
    await db("o_project").insert({ id: 7, imageModel: "vendor:model", imageQuality: "1K" });
    await db("o_assets").insert({ id: 10, projectId: 7, type: "role", name: "角色" });
    let current = entry();
    let media = png;
    let modelAvailable = true;
    const preflight = createBillableImagePreflight({ resolve: async () => current,
      readMedia: async () => media, isConfiguredImageModel: async (_vendorId, modelId) => modelAvailable && modelId === "model" });
    await db.transaction(async (tx) => {
      const first = await preflight(tx, scope);
      assert.equal(first.preview.estimatedMaxCostMicros, 200_000);
      assert.match(first.targetStateHash, /^[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(first).includes("一位角色"), false);
      current = { ...entry(), generationPrompt: "另一位角色" };
      assert.notEqual((await preflight(tx, scope)).targetStateHash, first.targetStateHash);
      current = entry();
      media = Buffer.concat([png, Buffer.from([1])]);
      assert.notEqual((await preflight(tx, scope)).targetStateHash, first.targetStateHash);
      media = Buffer.from("invalid");
      await assert.rejects(preflight(tx, scope), BillableImagePreflightError);
      media = png;
      modelAvailable = false;
      await assert.rejects(preflight(tx, scope), BillableImagePreflightError);
      modelAvailable = true;
      await assert.rejects(preflight(tx, { ...scope, modelId: "other" }), BillableImagePreflightError);
      await tx("o_project").where({ id: 7 }).update({ imageModel: "different:default", imageQuality: "4K" });
      assert.equal((await preflight(tx, scope)).targetStateHash, first.targetStateHash,
        "changing an unrelated Project default must not invalidate the selected approved model");
    });
  } finally { await db.destroy(); }
});

test("zero selected references remains a text-only preflight", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.schema.createTable("o_project", (t) => { t.integer("id"); t.text("imageModel"); t.text("imageQuality"); });
    await db.schema.createTable("o_assets", (t) => { t.integer("id"); t.integer("projectId"); t.text("name"); });
    await db("o_project").insert({ id: 7, imageModel: "vendor:model", imageQuality: "1K" });
    await db("o_assets").insert({ id: 10, projectId: 7, name: "角色" });
    const preflight = createBillableImagePreflight({ resolve: async () => ({ ...entry(), references: [], selectedReferenceIds: [] }),
      readMedia: async () => { throw new Error("unexpected media read"); }, isConfiguredImageModel: async () => true });
    await db.transaction(async (tx) => assert.match((await preflight(tx, scope)).targetStateHash, /^[a-f0-9]{64}$/));
  } finally { await db.destroy(); }
});
