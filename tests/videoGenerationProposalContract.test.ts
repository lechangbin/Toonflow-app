import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import { freezeVideoGenerationProposal, VideoGenerationProposalContractError } from
  "../src/controlledTools/videoGenerationProposalContract";
import { prepareControlledVideoProposal } from
  "../src/controlledTools/videoGenerationPreparation";
import { VideoPromptProfileRegistry } from "../src/video/promptProfile";
import type { VideoModelSummary } from "../src/vendor";
import { workOf } from "./databaseTestSupport";

const model: VideoModelSummary = { name: "Agnes Video V2.0",
  modelName: "agnes-video-v2.0", type: "video", capabilities: [{
    id: "text-to-video", promptProfileId: "agnes/text-v1", inputs: [],
    audio: { generation: "native", policy: "always" },
    outputPresets: [{ id: "720p", resolution: "720p",
      durations: { kind: "integer-range", min: 1, max: 18, step: 1 },
      aspectRatios: ["16:9"] }],
  }] };

const selection = {
  vendorId: "agnes", modelId: "agnes-video-v2.0", capabilityId: "text-to-video",
  inputs: [], output: { presetId: "720p", duration: 5,
    resolution: "720p", aspectRatio: "16:9" },
  audio: { generation: "native", enabled: true },
};
const payload = { scriptId: 11, item: { trackId: 31, promptRevisionId: 51, ...selection } };

async function database(): Promise<Knex> {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_script", (t) => {
    t.integer("id").primary(); t.integer("projectId");
  });
  await db.schema.createTable("o_videoTrack", (t) => {
    t.integer("id").primary(); t.integer("projectId"); t.integer("scriptId");
    t.text("state"); t.integer("videoId"); t.integer("selectVideoId");
    t.integer("promptRevisionId"); t.integer("duration");
    t.text("vendorId"); t.text("modelId"); t.text("capabilityId");
    t.text("inputRefs"); t.text("outputSelection"); t.text("audioSelection");
  });
  await db.schema.createTable("o_promptRevision", (t) => {
    t.integer("id").primary(); t.integer("projectId"); t.integer("videoTrackId");
    t.text("status"); t.text("profileId"); t.text("strategy");
    t.text("brief"); t.text("draft"); t.text("renderedPrompt");
  });
  await db.schema.createTable("o_video", (t) => {
    t.integer("id").primary(); t.integer("projectId"); t.integer("videoTrackId");
  });
  await db("o_script").insert([{ id: 11, projectId: 7 }, { id: 12, projectId: 8 }]);
  await db("o_videoTrack").insert({ id: 31, projectId: 7, scriptId: 11,
    state: "已完成", promptRevisionId: 51, duration: 5,
    vendorId: selection.vendorId, modelId: selection.modelId,
    capabilityId: selection.capabilityId, inputRefs: JSON.stringify(selection.inputs),
    outputSelection: JSON.stringify(selection.output),
    audioSelection: JSON.stringify(selection.audio) });
  await db("o_promptRevision").insert({ id: 51, projectId: 7,
    videoTrackId: 31, status: "active", profileId: "agnes/text-v1",
    strategy: "custom", brief: '{"subject":"A lantern"}',
    draft: '{"motion":"Sways"}',
    renderedPrompt: "A lantern sways in the wind" });
  return db;
}

test("single text-to-video candidate freezes exact Track and Prompt Revision without effects", async () => {
  const db = await database();
  try {
    const frozen = await freezeVideoGenerationProposal(db, 7, payload);
    assert.equal(frozen.preview.trackId, 31);
    assert.equal(frozen.preview.promptRevisionId, 51);
    assert.equal(frozen.preview.payloadHash, frozen.payloadHash);
    assert.match(frozen.targetStateHash, /^[0-9a-f]{64}$/);
    assert.equal(await db("o_video").count("id as count").first().then((row) => Number(row?.count)), 0);
    assert.equal(await db("o_videoTrack").where("id", 31).first("state")
      .then((row) => row?.state), "已完成");
  } finally { await db.destroy(); }
});

test("controlled Video preparation validates the configured capability without effects", async () => {
  const db = await database();
  try {
    const profiles = VideoPromptProfileRegistry.load(path.join(process.cwd(),
      "data", "promptProfiles", "video"));
    let submitted = 0;
    const dependencies = { db: workOf(db), profiles,
      vendor: { inspectVendor: async () => ({ vendorId: "agnes", name: "Agnes",
        inputs: [], models: [model] }),
      generateVideo: async () => { submitted++; return "VIDEO_BASE64"; } },
      readImage: async () => { throw new Error("text-to-video must not read images"); } };
    const prepared = await prepareControlledVideoProposal(dependencies, 7, payload);
    assert.match(prepared.commandHash, /^[0-9a-f]{64}$/);
    assert.equal(prepared.preview.trackId, 31);
    assert.equal(submitted, 0);
    assert.equal((await db("o_video")).length, 0);
    assert.equal((await db("o_videoTrack").where("id", 31).first()).state, "已完成");
    const missingModel = { ...dependencies, vendor: { ...dependencies.vendor,
      inspectVendor: async () => ({ vendorId: "agnes", name: "Agnes", inputs: [], models: [] }) } };
    await assert.rejects(prepareControlledVideoProposal(missingModel, 7, payload), /未找到 Video Model/);
    assert.equal(submitted, 0);
  } finally { await db.destroy(); }
});

test("controlled Video preparation rejects target drift during asynchronous Vendor inspection", async () => {
  const db = await database();
  try {
    const profiles = VideoPromptProfileRegistry.load(path.join(process.cwd(),
      "data", "promptProfiles", "video"));
    const dependencies = { db: workOf(db), profiles,
      vendor: { inspectVendor: async () => {
        await db("o_promptRevision").where("id", 51)
          .update({ renderedPrompt: "Changed while inspecting Vendor" });
        return { vendorId: "agnes", name: "Agnes", inputs: [], models: [model] };
      }, generateVideo: async () => { throw new Error("must not submit"); } },
      readImage: async () => { throw new Error("must not read images"); } };
    await assert.rejects(prepareControlledVideoProposal(dependencies, 7, payload),
      (error) => error instanceof VideoGenerationProposalContractError
        && error.reason === "version");
    assert.equal((await db("o_video")).length, 0);
  } finally { await db.destroy(); }
});

test("candidate rejects cross-Project targets, selected videos, and non-text inputs", async () => {
  const db = await database();
  try {
    await assert.rejects(freezeVideoGenerationProposal(db, 8, payload),
      (error) => error instanceof VideoGenerationProposalContractError
        && error.reason === "scope");
    await db("o_video").insert({ id: 61, projectId: 7, videoTrackId: 31 });
    await assert.rejects(freezeVideoGenerationProposal(db, 7, payload),
      (error) => error instanceof VideoGenerationProposalContractError
        && error.reason === "version");
    await db("o_video").delete();
    await assert.rejects(freezeVideoGenerationProposal(db, 7, {
      ...payload, item: { ...payload.item, capabilityId: "image-to-video",
        inputs: [{ role: "source-image", source: "uploaded-media",
          filePath: "C:/untrusted-image.png" }] },
    }), /text-to-video only/);
  } finally { await db.destroy(); }
});

test("candidate detects selection or Prompt Revision drift before later approval", async () => {
  const db = await database();
  try {
    const original = await freezeVideoGenerationProposal(db, 7, payload);
    await db("o_videoTrack").where("id", 31).update({ outputSelection: JSON.stringify({
      aspectRatio: "16:9", resolution: "720p", duration: 5, presetId: "720p",
    }) });
    assert.equal((await freezeVideoGenerationProposal(db, 7, payload)).targetStateHash,
      original.targetStateHash, "equivalent JSON key order should not look like target drift");
    await db("o_promptRevision").where("id", 51).update({ draft: '{"motion":"Changes"}' });
    const changedDraft = await freezeVideoGenerationProposal(db, 7, payload);
    assert.notEqual(changedDraft.targetStateHash, original.targetStateHash);
    await db("o_promptRevision").where("id", 51)
      .update({ renderedPrompt: "A changed prompt" });
    const changed = await freezeVideoGenerationProposal(db, 7, payload);
    assert.notEqual(changed.targetStateHash, original.targetStateHash);
    await db("o_videoTrack").where("id", 31)
      .update({ outputSelection: JSON.stringify({ ...selection.output, duration: 6 }) });
    await assert.rejects(freezeVideoGenerationProposal(db, 7, payload),
      (error) => error instanceof VideoGenerationProposalContractError
        && error.reason === "version");
    await db("o_videoTrack").where("id", 31).update({ outputSelection: "{" });
    await assert.rejects(freezeVideoGenerationProposal(db, 7, payload),
      (error) => error instanceof VideoGenerationProposalContractError
        && error.reason === "unsafe");
  } finally { await db.destroy(); }
});
