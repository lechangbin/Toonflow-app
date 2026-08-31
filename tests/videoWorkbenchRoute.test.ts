import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";
import knexFactory, { type Knex } from "knex";

import { createGetGenerateDataRouter } from "../src/routes/production/workbench/getGenerateDataRouter";
import { workOf } from "./databaseTestSupport";

const textToVideoModel = {
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
          aspectRatios: ["16:9", "9:16"],
        },
      ],
    },
  ],
};

async function createDatabase(): Promise<Knex> {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_project", (table) => {
    table.integer("id").primary();
    table.string("videoVendorId");
    table.string("videoModelId");
    table.string("videoCapabilityId");
    table.string("videoOutputPresetId");
    table.string("videoRatio");
  });
  await db.schema.createTable("o_videoTrack", (table) => {
    table.integer("id").primary();
    table.integer("projectId");
    table.integer("scriptId");
    table.integer("videoId");
    table.integer("duration");
    table.string("state");
    table.string("reason");
    table.string("vendorId");
    table.string("modelId");
    table.string("capabilityId");
    table.text("inputRefs");
    table.text("outputSelection");
    table.text("audioSelection");
    table.integer("promptRevisionId");
  });
  await db.schema.createTable("o_promptRevision", (table) => {
    table.integer("id").primary();
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
  await db.schema.createTable("o_video", (table) => {
    table.integer("id").primary();
    table.integer("videoTrackId");
    table.string("filePath");
    table.string("state");
    table.string("errorReason");
    table.integer("generationTaskId");
    table.integer("artifactRevisionId");
  });
  await db.schema.createTable("o_generationTask", (table) => {
    table.integer("id").primary();
    table.integer("videoTrackId");
    table.text("commandSnapshot");
  });
  await db.schema.createTable("o_artifactRevision", (table) => {
    table.integer("id").primary();
    table.integer("videoTrackId");
    table.integer("videoId");
    table.integer("generationTaskId");
    table.integer("revision");
    table.string("status");
    table.integer("createdAt");
  });
  await db.schema.createTable("o_storyboard", (table) => {
    table.integer("id").primary();
    table.integer("projectId");
    table.integer("scriptId");
    table.integer("trackId");
    table.integer("index");
    table.string("filePath");
    table.text("prompt");
    table.text("videoDesc");
  });
  return db;
}

async function insertConfiguredTrack(db: Knex) {
  await db("o_videoTrack").insert({
    id: 21,
    projectId: 1,
    scriptId: 2,
    duration: 6,
    state: "已完成",
    vendorId: "agnes",
    modelId: "agnes-video-v2.0",
    capabilityId: "text-to-video",
    inputRefs: JSON.stringify([]),
    outputSelection: JSON.stringify({ presetId: "720p", duration: 6, resolution: "720p", aspectRatio: "16:9" }),
    audioSelection: JSON.stringify({ generation: "native", enabled: true }),
  });
}

function createApp(db: Knex) {
  const app = express();
  app.use(express.json());
  app.use(
    createGetGenerateDataRouter({
      db: workOf(db),
      getVendorModels: async () => [textToVideoModel],
      getFileUrl: async (filePath) => `/oss${filePath}`,
      getSmallImageUrl: async (filePath) => `/small${filePath}`,
    }),
  );
  app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(500).json({ message: error.message });
  });
  return app;
}

async function postTrackList(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: 1, scriptId: 2 }),
    });
    return { status: response.status, body: (await response.json()) as any };
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("a configured Video Track is returned even when the Project video defaults are missing", async () => {
  const db = await createDatabase();
  await db("o_project").insert({ id: 1 });
  await insertConfiguredTrack(db);
  try {
    const { status, body } = await postTrackList(createApp(db));
    assert.equal(status, 200);
    assert.equal(body.data.projectDefaults, null);
    const track = body.data.trackList.find((item: any) => item.id === 21);
    assert.deepEqual(track.actual, {
      vendorId: "agnes",
      modelId: "agnes-video-v2.0",
      capabilityId: "text-to-video",
      inputRefs: [],
      outputSelection: { presetId: "720p", duration: 6, resolution: "720p", aspectRatio: "16:9" },
      audioSelection: { generation: "native", enabled: true },
      promptRevisionId: null,
    });
  } finally {
    await db.destroy();
  }
});

test("a fully configured Project returns its defaults for new Track creation", async () => {
  const db = await createDatabase();
  await db("o_project").insert({
    id: 1,
    videoVendorId: "agnes",
    videoModelId: "agnes-video-v2.0",
    videoCapabilityId: "text-to-video",
    videoOutputPresetId: "720p",
    videoRatio: "16:9",
  });
  await insertConfiguredTrack(db);
  try {
    const { status, body } = await postTrackList(createApp(db));
    assert.equal(status, 200);
    assert.deepEqual(body.data.projectDefaults, {
      vendorId: "agnes",
      modelId: "agnes-video-v2.0",
      capabilityId: "text-to-video",
      outputPresetId: "720p",
      aspectRatio: "16:9",
    });
    assert.equal(body.data.trackList.length, 1);
  } finally {
    await db.destroy();
  }
});
