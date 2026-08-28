import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import { db as globalDatabase, dbReady } from "../src/utils/db";
import { createVideoProduction } from "../src/video/production";
import { createVideoPromptGeneration } from "../src/video/promptGeneration";
import { VideoPromptProfileRegistry } from "../src/video/promptProfile";

const model = {
  name: "Agnes Video V2.0",
  modelName: "agnes-video-v2.0",
  type: "video",
  capabilities: [
    {
      id: "text-to-video",
      promptProfileId: "agnes/text-v1",
      inputs: [],
      audio: { generation: "native", policy: "always" },
      outputPresets: [
        {
          id: "720p",
          resolution: "720p",
          durations: { kind: "integer-range", min: 1, max: 18, step: 1 },
          aspectRatios: ["16:9"],
        },
      ],
    },
  ],
};

test.after(async () => {
  await dbReady;
  await globalDatabase.destroy();
});

async function createDatabase(): Promise<Knex> {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_videoTrack", (table) => {
    table.integer("id").primary();
    table.integer("projectId");
    table.integer("scriptId");
    table.string("vendorId");
    table.string("modelId");
    table.string("capabilityId");
    table.text("inputRefs");
    table.text("outputSelection");
    table.text("audioSelection");
    table.integer("promptRevisionId");
    table.integer("duration");
    table.string("state");
    table.text("reason");
  });
  await db.schema.createTable("o_promptRevision", (table) => {
    table.increments("id");
    table.integer("projectId");
    table.integer("videoTrackId");
    table.string("profileId");
    table.string("strategy");
    table.text("brief");
    table.text("draft");
    table.text("renderedPrompt");
    table.string("status");
    table.integer("createdAt");
  });
  await db.schema.createTable("o_productionAction", (table) => {
    table.increments("id");
    table.integer("projectId");
    table.string("actionType");
    table.string("requestedBy");
    table.string("status");
    table.integer("createdAt");
    table.integer("completedAt");
  });
  await db.schema.createTable("o_generationTask", (table) => {
    table.increments("id");
    table.integer("actionId");
    table.integer("projectId");
    table.integer("videoTrackId");
    table.string("vendorId");
    table.string("modelId");
    table.string("capabilityId");
    table.integer("promptRevisionId");
    table.text("commandSnapshot");
    table.text("providerTaskSnapshot");
    table.string("status");
    table.integer("artifactRevisionId");
    table.integer("startedAt");
    table.integer("completedAt");
    table.text("error");
  });
  await db.schema.createTable("o_video", (table) => {
    table.increments("id");
    table.text("filePath");
    table.integer("time");
    table.string("state");
    table.integer("scriptId");
    table.integer("projectId");
    table.integer("videoTrackId");
    table.integer("generationTaskId");
    table.integer("artifactRevisionId");
    table.text("errorReason");
  });
  await db.schema.createTable("o_artifactRevision", (table) => {
    table.increments("id");
    table.integer("actionId");
    table.integer("generationTaskId");
    table.integer("videoId");
    table.integer("videoTrackId");
    table.integer("revision");
    table.string("status");
    table.integer("createdAt");
  });
  return db;
}

test("fake prompt and video dependencies drive a successful durable orchestration", async () => {
  const db = await createDatabase();
  const profiles = VideoPromptProfileRegistry.load(path.join(process.cwd(), "data", "promptProfiles", "video"));
  const writes: { filePath: string; base64: string }[] = [];
  await db("o_videoTrack").insert({ id: 11, projectId: 1, scriptId: 2, state: "未生成" });

  try {
    const promptGeneration = createVideoPromptGeneration({
      db,
      profiles,
      getVendorModels: async () => [model],
      generateDraft: async () => ({ subject: "A lantern", motion: "Slowly sways in the wind" }),
      now: () => 100,
    });
    const prompt = await promptGeneration.generateVideoPromptRevision({
      trackId: 11,
      projectId: 1,
      vendorId: "agnes",
      modelId: "agnes-video-v2.0",
      capabilityId: "text-to-video",
      requestedBy: "project-agent",
      strategy: "standard-with-guidance",
      brief: { subject: "A lantern", motion: "Slowly sways in the wind" },
    });

    const production = createVideoProduction({
      db,
      profiles,
      loadRuntime: async () => ({
        getModel: () => model,
        getRequest: () => async () => "VIDEO_BASE64",
      }),
      readImage: async () => {
        throw new Error("text-to-video must not load images");
      },
      writeVideo: async (filePath, base64) => {
        writes.push({ filePath, base64 });
      },
      downloadVideo: async () => {
        throw new Error("base64 result must not download");
      },
      createVideoPath: () => "/1/video/fake.mp4",
      now: () => 200,
    });
    const started = await production.startVideoGenerationBatch({
      projectId: 1,
      scriptId: 2,
      requestedBy: "project-agent",
      items: [
        {
          trackId: 11,
          vendorId: "agnes",
          modelId: "agnes-video-v2.0",
          capabilityId: "text-to-video",
          inputs: [],
          output: { presetId: "720p", duration: 5, resolution: "720p", aspectRatio: "16:9" },
          audio: { generation: "native", enabled: true },
          promptRevisionId: prompt.promptRevisionId,
        },
      ],
    });
    await started.completion;

    assert.deepEqual(writes, [{ filePath: "/1/video/fake.mp4", base64: "VIDEO_BASE64" }]);
    assert.equal((await db("o_productionAction").where("id", started.actionId).first()).status, "succeeded");
    assert.equal((await db("o_generationTask").first()).status, "succeeded");
    assert.equal((await db("o_artifactRevision").first()).status, "generated");
    assert.equal((await db("o_video").first()).state, "生成成功");
    const track = await db("o_videoTrack").where("id", 11).first();
    assert.equal(track.state, "已完成");
    assert.equal(track.promptRevisionId, prompt.promptRevisionId);
    assert.deepEqual(JSON.parse(track.audioSelection), { generation: "native", enabled: true });
  } finally {
    await db.destroy();
  }
});

test("a fake adapter failure rejects the Artifact and fails every owning record", async () => {
  const db = await createDatabase();
  const profiles = VideoPromptProfileRegistry.load(path.join(process.cwd(), "data", "promptProfiles", "video"));
  await db("o_videoTrack").insert({ id: 12, projectId: 1, scriptId: 2, state: "未生成" });

  try {
    const prompt = await createVideoPromptGeneration({
      db,
      profiles,
      getVendorModels: async () => [model],
      generateDraft: async () => ({ subject: "A lantern" }),
      now: () => 100,
    }).generateVideoPromptRevision({
      trackId: 12,
      projectId: 1,
      vendorId: "agnes",
      modelId: "agnes-video-v2.0",
      capabilityId: "text-to-video",
      requestedBy: "user",
      strategy: "standard",
      brief: { subject: "A lantern" },
    });
    const production = createVideoProduction({
      db,
      profiles,
      loadRuntime: async () => ({
        getModel: () => model,
        getRequest: () => async () => {
          throw new Error("provider rejected request");
        },
      }),
      readImage: async () => "",
      writeVideo: async () => undefined,
      downloadVideo: async () => "",
      createVideoPath: () => "/1/video/failed.mp4",
      now: () => 200,
    });
    const started = await production.startVideoGenerationBatch({
      projectId: 1,
      scriptId: 2,
      requestedBy: "user",
      items: [
        {
          trackId: 12,
          vendorId: "agnes",
          modelId: "agnes-video-v2.0",
          capabilityId: "text-to-video",
          inputs: [],
          output: { presetId: "720p", duration: 5, resolution: "720p", aspectRatio: "16:9" },
          audio: { generation: "native", enabled: true },
          promptRevisionId: prompt.promptRevisionId,
        },
      ],
    });
    await started.completion;

    assert.equal((await db("o_productionAction").where("id", started.actionId).first()).status, "failed");
    assert.equal((await db("o_generationTask").first()).status, "failed");
    assert.equal((await db("o_artifactRevision").first()).status, "rejected");
    assert.equal((await db("o_video").first()).state, "生成失败");
    const track = await db("o_videoTrack").where("id", 12).first();
    assert.equal(track.state, "生成失败");
    assert.equal(track.reason, "provider rejected request");
    assert.deepEqual(JSON.parse(track.audioSelection), { generation: "native", enabled: true });
  } finally {
    await db.destroy();
  }
});
