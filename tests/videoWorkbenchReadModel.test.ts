import assert from "node:assert/strict";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import { readVideoTrackProjections } from "../src/video/workbenchReadModel";

async function createDatabase(): Promise<Knex> {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
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
  return db;
}

const getVendorModels = async () => [
  {
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
  },
  {
    name: "Volcengine Video V1.0",
    modelName: "volcengine-video-v1.0",
    type: "video",
    capabilities: [
      {
        id: "first-last-frame",
        promptProfileId: "volcengine/frame-v1",
        inputs: [
          { role: "first-frame", mediaType: "image", required: true },
          { role: "last-frame", mediaType: "image", required: true },
        ],
        audio: { generation: "native", policy: "optional" },
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
  },
];

test("a configured Video Track resumes its actual selection, Prompt Revision, and Artifact Revision", async () => {
  const db = await createDatabase();
  await db("o_videoTrack").insert({
    id: 7,
    projectId: 1,
    scriptId: 2,
    videoId: 31,
    duration: 6,
    state: "已完成",
    vendorId: "agnes",
    modelId: "agnes-video-v2.0",
    capabilityId: "keyframe-to-video",
    inputRefs: JSON.stringify([
      { role: "first-frame", source: "storyboard", sourceId: 11 },
      { role: "intermediate-keyframe", source: "uploaded-media", filePath: "/1/video-inputs/middle.png" },
      { role: "last-frame", source: "storyboard", sourceId: 12 },
    ]),
    outputSelection: JSON.stringify({ presetId: "720p", duration: 6, resolution: "720p", aspectRatio: "9:16" }),
    audioSelection: JSON.stringify({ generation: "native", enabled: true }),
    promptRevisionId: 21,
  });
  await db("o_promptRevision").insert({
    id: 21,
    projectId: 1,
    videoTrackId: 7,
    profileId: "agnes/keyframe-v1",
    strategy: "custom",
    brief: JSON.stringify({ subject: "A runner", constraints: [], references: [] }),
    draft: null,
    renderedPrompt: "Move through all three keyframes",
    status: "active",
    createdAt: 100,
  });
  await db("o_generationTask").insert({
    id: 41,
    videoTrackId: 7,
    commandSnapshot: JSON.stringify({ audio: { generation: "native", enabled: true } }),
  });
  await db("o_video").insert({
    id: 31,
    videoTrackId: 7,
    filePath: "/1/video/result.mp4",
    state: "生成成功",
    generationTaskId: 41,
    artifactRevisionId: 51,
  });
  await db("o_artifactRevision").insert({
    id: 51,
    videoTrackId: 7,
    videoId: 31,
    generationTaskId: 41,
    revision: 1,
    status: "accepted",
    createdAt: 200,
  });

  try {
    const [track] = await readVideoTrackProjections(
      { db, getVendorModels, getFileUrl: async (filePath) => `/oss${filePath}` },
      { projectId: 1, scriptId: 2 },
    );
    assert.deepEqual(track.actual, {
      vendorId: "agnes",
      modelId: "agnes-video-v2.0",
      capabilityId: "keyframe-to-video",
      inputRefs: [
        { role: "first-frame", source: "storyboard", sourceId: 11 },
        {
          role: "intermediate-keyframe",
          source: "uploaded-media",
          filePath: "/1/video-inputs/middle.png",
          displayUrl: "/oss/1/video-inputs/middle.png",
        },
        { role: "last-frame", source: "storyboard", sourceId: 12 },
      ],
      outputSelection: { presetId: "720p", duration: 6, resolution: "720p", aspectRatio: "9:16" },
      audioSelection: { generation: "native", enabled: true },
      promptRevisionId: 21,
    });
    assert.equal(track.prompt, "Move through all three keyframes");
    assert.deepEqual(track.promptRevision, {
      id: 21,
      profileId: "agnes/keyframe-v1",
      strategy: "custom",
      brief: { subject: "A runner", constraints: [], references: [] },
      draft: null,
      renderedPrompt: "Move through all three keyframes",
      status: "active",
      createdAt: 100,
    });
    assert.deepEqual(track.selectedArtifact, {
      id: 51,
      revision: 1,
      status: "accepted",
      videoId: 31,
      generationTaskId: 41,
      createdAt: 200,
    });
    assert.equal(track.videoList[0].artifactRevision.status, "accepted");
  } finally {
    await db.destroy();
  }
});

test("an unconfigured Video Track does not inherit Project defaults in the read model", async () => {
  const db = await createDatabase();
  await db("o_videoTrack").insert({ id: 8, projectId: 1, scriptId: 2, duration: 5, state: null });
  try {
    const [track] = await readVideoTrackProjections(
      { db, getVendorModels, getFileUrl: async (filePath) => filePath },
      { projectId: 1, scriptId: 2 },
    );
    assert.deepEqual(track.actual, {
      vendorId: null,
      modelId: null,
      capabilityId: null,
      inputRefs: null,
      outputSelection: null,
      audioSelection: null,
      promptRevisionId: null,
    });
  } finally {
    await db.destroy();
  }
});

test("the persisted audioSelection wins over the last generation task snapshot", async () => {
  const db = await createDatabase();
  await db("o_videoTrack").insert({
    id: 11,
    projectId: 1,
    scriptId: 2,
    vendorId: "volcengine",
    modelId: "volcengine-video-v1.0",
    capabilityId: "first-last-frame",
    inputRefs: JSON.stringify([]),
    outputSelection: JSON.stringify({ presetId: "720p", duration: 6, resolution: "720p", aspectRatio: "16:9" }),
    audioSelection: JSON.stringify({ generation: "native", enabled: false }),
  });
  await db("o_generationTask").insert({
    id: 61,
    videoTrackId: 11,
    commandSnapshot: JSON.stringify({ audio: { generation: "native", enabled: true } }),
  });
  try {
    const [track] = await readVideoTrackProjections(
      { db, getVendorModels, getFileUrl: async (filePath) => filePath },
      { projectId: 1, scriptId: 2 },
    );
    assert.deepEqual(track.actual.audioSelection, { generation: "native", enabled: false });
  } finally {
    await db.destroy();
  }
});

test("a legacy configured Track without persisted audioSelection resumes the last generation snapshot audio", async () => {
  const db = await createDatabase();
  await db("o_videoTrack").insert({
    id: 12,
    projectId: 1,
    scriptId: 2,
    vendorId: "volcengine",
    modelId: "volcengine-video-v1.0",
    capabilityId: "first-last-frame",
    inputRefs: JSON.stringify([]),
    outputSelection: JSON.stringify({ presetId: "720p", duration: 6, resolution: "720p", aspectRatio: "16:9" }),
  });
  await db("o_generationTask").insert({
    id: 62,
    videoTrackId: 12,
    commandSnapshot: JSON.stringify({ audio: { generation: "native", enabled: true } }),
  });
  try {
    const [track] = await readVideoTrackProjections(
      { db, getVendorModels, getFileUrl: async (filePath) => filePath },
      { projectId: 1, scriptId: 2 },
    );
    assert.deepEqual(track.actual.audioSelection, { generation: "native", enabled: true });
  } finally {
    await db.destroy();
  }
});

test("a configured Track without persisted audioSelection or tasks derives the capability audio default", async () => {
  const db = await createDatabase();
  await db("o_videoTrack").insert([
    {
      id: 13,
      projectId: 1,
      scriptId: 2,
      vendorId: "agnes",
      modelId: "agnes-video-v2.0",
      capabilityId: "keyframe-to-video",
      inputRefs: JSON.stringify([]),
      outputSelection: JSON.stringify({ presetId: "720p", duration: 6, resolution: "720p", aspectRatio: "9:16" }),
    },
    {
      id: 14,
      projectId: 1,
      scriptId: 2,
      vendorId: "volcengine",
      modelId: "volcengine-video-v1.0",
      capabilityId: "first-last-frame",
      inputRefs: JSON.stringify([]),
      outputSelection: JSON.stringify({ presetId: "720p", duration: 6, resolution: "720p", aspectRatio: "16:9" }),
    },
  ]);
  try {
    const tracks = await readVideoTrackProjections(
      { db, getVendorModels, getFileUrl: async (filePath) => filePath },
      { projectId: 1, scriptId: 2 },
    );
    assert.deepEqual(tracks.find((track) => track.id === 13)?.actual.audioSelection, {
      generation: "native",
      enabled: true,
    });
    assert.deepEqual(tracks.find((track) => track.id === 14)?.actual.audioSelection, {
      generation: "native",
      enabled: true,
    });
  } finally {
    await db.destroy();
  }
});

test("corrupt persisted Video Track JSON fails explicitly at the read seam", async () => {
  const db = await createDatabase();
  await db("o_videoTrack").insert({
    id: 9,
    projectId: 1,
    scriptId: 2,
    vendorId: "agnes",
    modelId: "agnes-video-v2.0",
    capabilityId: "keyframe-to-video",
    inputRefs: "not json",
    outputSelection: JSON.stringify({ presetId: "720p", duration: 6, resolution: "720p", aspectRatio: "9:16" }),
  });
  try {
    await assert.rejects(
      readVideoTrackProjections(
        { db, getVendorModels, getFileUrl: async (filePath) => filePath },
        { projectId: 1, scriptId: 2 },
      ),
      /Video Track 9 inputRefs 包含无效 JSON/,
    );
  } finally {
    await db.destroy();
  }
});

test("corrupt persisted audioSelection fails explicitly at the read seam", async () => {
  const db = await createDatabase();
  await db("o_videoTrack").insert({
    id: 15,
    projectId: 1,
    scriptId: 2,
    vendorId: "agnes",
    modelId: "agnes-video-v2.0",
    capabilityId: "keyframe-to-video",
    inputRefs: JSON.stringify([]),
    outputSelection: JSON.stringify({ presetId: "720p", duration: 6, resolution: "720p", aspectRatio: "9:16" }),
    audioSelection: JSON.stringify({ generation: "native" }),
  });
  try {
    await assert.rejects(
      readVideoTrackProjections(
        { db, getVendorModels, getFileUrl: async (filePath) => filePath },
        { projectId: 1, scriptId: 2 },
      ),
      /Video Track 15 audioSelection 无效/,
    );
  } finally {
    await db.destroy();
  }
});

test("foreign Prompt and Artifact Revisions are rejected by the read seam", async () => {
  const db = await createDatabase();
  await db("o_videoTrack").insert({ id: 10, projectId: 1, scriptId: 2, videoId: 32, promptRevisionId: 22 });
  await db("o_promptRevision").insert({
    id: 22,
    projectId: 99,
    videoTrackId: 10,
    profileId: "agnes/keyframe-v1",
    strategy: "custom",
    renderedPrompt: "foreign",
  });
  await db("o_video").insert({ id: 32, videoTrackId: 10, artifactRevisionId: 52 });
  await db("o_artifactRevision").insert({ id: 52, videoTrackId: 99, videoId: 32, revision: 1, status: "accepted" });
  try {
    await assert.rejects(
      readVideoTrackProjections(
        { db, getVendorModels, getFileUrl: async (filePath) => filePath },
        { projectId: 1, scriptId: 2 },
      ),
      /Prompt Revision 22 不属于 Project 1 \/ Video Track 10/,
    );
  } finally {
    await db.destroy();
  }
});
