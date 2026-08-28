import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createVideoTrack } from "../src/video/trackCreation";

const agnesVideoModel = {
  name: "Agnes Video V2.0",
  modelName: "agnes-video-v2.0",
  type: "video",
  capabilities: [
    {
      id: "keyframe-to-video",
      promptProfileId: "agnes/keyframe-v1",
      inputs: [
        { role: "first-frame", mediaType: "image", required: true },
        { role: "intermediate-keyframe", mediaType: "image", required: false },
        { role: "last-frame", mediaType: "image", required: true },
      ],
      transitions: { kind: "adjacent-keyframes" },
      audio: { generation: "native", policy: "always" },
      outputPresets: [
        {
          id: "720p",
          resolution: "720p",
          durations: { kind: "integer-range", min: 1, max: 18, step: 1 },
          aspectRatios: ["16:9", "9:16"],
        },
      ],
    },
  ],
};

test("a new Video Track copies validated Project defaults as its actual selection", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_project", (table) => {
    table.integer("id").primary();
    table.string("videoVendorId");
    table.string("videoModelId");
    table.string("videoCapabilityId");
    table.string("videoOutputPresetId");
    table.string("videoRatio");
  });
  await db.schema.createTable("o_script", (table) => {
    table.integer("id").primary();
    table.integer("projectId");
  });
  await db.schema.createTable("o_videoTrack", (table) => {
    table.integer("id").primary();
    table.integer("projectId");
    table.integer("scriptId");
    table.integer("duration");
    table.string("vendorId");
    table.string("modelId");
    table.string("capabilityId");
    table.text("inputRefs");
    table.text("outputSelection");
    table.text("audioSelection");
  });
  await db("o_project").insert({
    id: 1,
    videoVendorId: "agnes",
    videoModelId: "agnes-video-v2.0",
    videoCapabilityId: "keyframe-to-video",
    videoOutputPresetId: "720p",
    videoRatio: "9:16",
  });
  await db("o_script").insert({ id: 2, projectId: 1 });

  try {
    const track = await createVideoTrack(
      { db, getVendorModels: async () => [agnesVideoModel] },
      { id: 101, projectId: 1, scriptId: 2, duration: 6 },
    );

    assert.deepEqual(track, {
      id: 101,
      projectId: 1,
      scriptId: 2,
      duration: 6,
      vendorId: "agnes",
      modelId: "agnes-video-v2.0",
      capabilityId: "keyframe-to-video",
      inputRefs: [],
      outputSelection: { presetId: "720p", duration: 6, resolution: "720p", aspectRatio: "9:16" },
      audioSelection: { generation: "native", enabled: true },
    });
    const persisted = await db("o_videoTrack").where("id", 101).first();
    assert.deepEqual(JSON.parse(persisted.outputSelection), track.outputSelection);
    assert.deepEqual(JSON.parse(persisted.audioSelection), track.audioSelection);
  } finally {
    await db.destroy();
  }
});

test("a Video Track rejects a Script owned by another Project before persistence", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_project", (table) => {
    table.integer("id").primary();
    table.string("videoVendorId");
    table.string("videoModelId");
    table.string("videoCapabilityId");
    table.string("videoOutputPresetId");
    table.string("videoRatio");
  });
  await db.schema.createTable("o_script", (table) => {
    table.integer("id").primary();
    table.integer("projectId");
  });
  await db.schema.createTable("o_videoTrack", (table) => table.integer("id").primary());
  await db("o_project").insert({
    id: 1,
    videoVendorId: "agnes",
    videoModelId: "agnes-video-v2.0",
    videoCapabilityId: "keyframe-to-video",
    videoOutputPresetId: "720p",
    videoRatio: "9:16",
  });
  await db("o_script").insert({ id: 2, projectId: 9 });

  try {
    await assert.rejects(
      createVideoTrack(
        { db, getVendorModels: async () => [agnesVideoModel] },
        { id: 102, projectId: 1, scriptId: 2, duration: 6 },
      ),
      /Script 2 不属于 Project 1/,
    );
    assert.equal(await db("o_videoTrack").where("id", 102).first(), undefined);
  } finally {
    await db.destroy();
  }
});
