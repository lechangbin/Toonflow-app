import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { freezeStoryboardWriteProposal, StoryboardWriteContractError } from
  "../src/controlledTools/storyboardWriteContract";
import { insertApprovedStoryboard } from "../src/controlledTools/storyboardWriteEffect";

async function database() {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_script", (t) => {
    t.integer("id").primary(); t.integer("projectId");
  });
  await db.schema.createTable("o_videoTrack", (t) => {
    t.integer("id").primary(); t.integer("projectId"); t.integer("scriptId");
    t.integer("videoId"); t.integer("selectVideoId"); t.integer("duration");
    t.text("vendorId"); t.text("modelId"); t.text("capabilityId");
  });
  await db.schema.createTable("o_assets", (t) => {
    t.integer("id").primary(); t.integer("projectId");
    t.integer("scriptId"); t.integer("assetsId");
  });
  await db.schema.createTable("o_scriptAssets", (t) => {
    t.integer("scriptId"); t.integer("assetId");
  });
  await db.schema.createTable("o_storyboard", (t) => {
    t.increments("id"); t.integer("projectId"); t.integer("scriptId");
    t.integer("trackId"); t.text("videoDesc"); t.text("prompt");
    t.text("duration"); t.text("filePath"); t.text("state");
    t.integer("shouldGenerateImage"); t.integer("createTime");
  });
  await db.schema.createTable("o_assets2Storyboard", (t) => {
    t.integer("storyboardId"); t.integer("assetId");
    t.primary(["storyboardId", "assetId"]);
  });
  await db("o_script").insert([{ id: 11, projectId: 7 }, { id: 12, projectId: 8 }]);
  await db("o_videoTrack").insert([{ id: 31, projectId: 7, scriptId: 11,
    duration: 4, vendorId: "vendor", modelId: "video", capabilityId: "text-to-video" },
  { id: 32, projectId: 8, scriptId: 12, duration: 4 }]);
  await db("o_assets").insert([{ id: 21, projectId: 7, scriptId: null },
    { id: 22, projectId: 7, scriptId: 11 },
    { id: 23, projectId: 8, scriptId: 12 }]);
  await db("o_scriptAssets").insert({ scriptId: 11, assetId: 21 });
  return db;
}

const payload = { scriptId: 11, trackId: 31, videoDesc: "角色走入庭院",
  prompt: null, duration: 4, shouldGenerateImage: false,
  associateAssetsIds: [21, 22] };

test("Storyboard proposal freezes one Project/Script/Track/Asset-scoped candidate", async () => {
  const db = await database();
  try {
    const frozen = await freezeStoryboardWriteProposal(db, 7, payload);
    assert.deepEqual(frozen.payload, payload);
    assert.equal(frozen.preview.assetCount, 2);
    assert.match(frozen.payloadHash, /^[a-f0-9]{64}$/);
    assert.match(frozen.targetStateHash, /^[a-f0-9]{64}$/);
    assert.equal((await db("o_scriptAssets")).length, 1,
      "preflight cannot write a Storyboard or association");
  } finally { await db.destroy(); }
});

test("approved effect inserts one Storyboard and links in the caller transaction", async () => {
  const db = await database();
  try {
    const frozen = await freezeStoryboardWriteProposal(db, 7, payload);
    const result = await db.transaction((tx) => insertApprovedStoryboard(tx, {
      projectId: 7, payload: frozen.payload, payloadHash: frozen.payloadHash,
      targetStateHash: frozen.targetStateHash, now: 123,
    }));
    assert.equal(result.assetCount, 2);
    assert.deepEqual(await db("o_assets2Storyboard").where({ storyboardId: result.storyboardId })
      .orderBy("assetId").pluck("assetId"), [21, 22]);
    const row = await db("o_storyboard").where({ id: result.storyboardId }).first();
    assert.equal(row.state, "未生成");
    assert.equal(row.filePath, null);
    assert.equal(row.shouldGenerateImage, 0);
    await assert.rejects(db.transaction((tx) => insertApprovedStoryboard(tx, {
      projectId: 7, payload: frozen.payload, payloadHash: frozen.payloadHash,
      targetStateHash: frozen.targetStateHash, now: 124,
    })), StoryboardWriteContractError);
    assert.equal((await db("o_storyboard")).length, 1);
  } finally { await db.destroy(); }
});

test("target drift and association insertion failure roll back the Storyboard", async () => {
  const db = await database();
  try {
    const frozen = await freezeStoryboardWriteProposal(db, 7, payload);
    await db("o_videoTrack").where({ id: 31 }).update({ duration: 5 });
    await assert.rejects(db.transaction((tx) => insertApprovedStoryboard(tx, {
      projectId: 7, payload: frozen.payload, payloadHash: frozen.payloadHash,
      targetStateHash: frozen.targetStateHash, now: 123,
    })), StoryboardWriteContractError);
    await db("o_videoTrack").where({ id: 31 }).update({ duration: 4 });
    await db.schema.dropTable("o_assets2Storyboard");
    await assert.rejects(db.transaction((tx) => insertApprovedStoryboard(tx, {
      projectId: 7, payload: frozen.payload, payloadHash: frozen.payloadHash,
      targetStateHash: frozen.targetStateHash, now: 123,
    })));
    assert.equal((await db("o_storyboard")).length, 0);
  } finally { await db.destroy(); }
});

test("Storyboard proposal rejects cross-Project or unrelated Script and Asset IDs", async () => {
  const db = await database();
  try {
    for (const changed of [
      { ...payload, trackId: 32 },
      { ...payload, associateAssetsIds: [23] },
      { ...payload, associateAssetsIds: [21, 21] },
      { ...payload, duration: 0 },
    ]) await assert.rejects(freezeStoryboardWriteProposal(db, 7, changed));
    await db("o_scriptAssets").where({ scriptId: 11, assetId: 21 }).delete();
    await assert.rejects(freezeStoryboardWriteProposal(db, 7, payload),
      StoryboardWriteContractError);
  } finally { await db.destroy(); }
});

test("Storyboard proposal target hash changes after Track selection changes", async () => {
  const db = await database();
  try {
    const first = await freezeStoryboardWriteProposal(db, 7, payload);
    await db("o_videoTrack").where({ id: 31 }).update({ modelId: "new-video" });
    const second = await freezeStoryboardWriteProposal(db, 7, payload);
    assert.notEqual(second.targetStateHash, first.targetStateHash);
    await db("o_videoTrack").where({ id: 31 }).update({ videoId: 99 });
    await assert.rejects(freezeStoryboardWriteProposal(db, 7, payload),
      StoryboardWriteContractError);
  } finally { await db.destroy(); }
});

test("Storyboard proposal rejects a different Track duration or an occupied Track", async () => {
  const db = await database();
  try {
    await assert.rejects(freezeStoryboardWriteProposal(db, 7, { ...payload, duration: 5 }),
      StoryboardWriteContractError);
    await db("o_storyboard").insert({ id: 1, projectId: 7, trackId: 31 });
    await assert.rejects(freezeStoryboardWriteProposal(db, 7, payload),
      StoryboardWriteContractError);
  } finally { await db.destroy(); }
});
