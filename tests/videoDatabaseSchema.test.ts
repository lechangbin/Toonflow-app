import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory from "knex";

import initDB from "../src/lib/initDB";
import fixDB from "../src/lib/fixDB";

function createTemporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-video-schema-"));
  const databasePath = path.join(directory, "db.sqlite");
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: databasePath },
    useNullAsDefault: true,
  });
  return { directory, knex };
}

test("a fresh database owns the explicit Video production records without legacy Project mode", async () => {
  const { directory, knex } = createTemporaryDatabase();

  try {
    await knex.raw("PRAGMA foreign_keys = OFF");
    // Avoid initializing unrelated embedding fixtures; this test exercises schema ownership.
    await knex.schema.createTable("o_skillList", (table) => table.text("id").primary());
    await initDB(knex);

    const projectColumns = await knex("o_project").columnInfo();
    assert.ok(projectColumns.videoVendorId);
    assert.ok(projectColumns.videoModelId);
    assert.ok(projectColumns.videoCapabilityId);
    assert.ok(projectColumns.videoOutputPresetId);
    assert.equal(projectColumns.mode, undefined);
    assert.equal(projectColumns.videoModel, undefined);

    const trackColumns = await knex("o_videoTrack").columnInfo();
    assert.ok(trackColumns.inputRefs);
    assert.ok(trackColumns.outputSelection);
    assert.ok(trackColumns.promptRevisionId);
    assert.equal(trackColumns.prompt, undefined);

    const taskColumns = await knex("o_generationTask").columnInfo();
    assert.ok(taskColumns.commandSnapshot);
    assert.ok(taskColumns.promptRevisionId);
    const artifactColumns = await knex("o_artifactRevision").columnInfo();
    assert.ok(artifactColumns.videoTrackId);

    const vendorIds = (await knex("o_vendorConfig").select("id")).map((row) => row.id).sort();
    assert.deepEqual(vendorIds, ["agnes", "deepseek", "minimax", "volcengine", "volcengineSd2"]);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an upgraded database drops legacy Video routing and creates durable production records", async () => {
  const { directory, knex } = createTemporaryDatabase();
  const dataRoot = path.join(directory, "data");
  fs.cpSync(path.join(process.cwd(), "data", "vendor"), path.join(dataRoot, "vendor"), { recursive: true });
  fs.cpSync(path.join(process.cwd(), "data", "promptProfiles"), path.join(dataRoot, "promptProfiles"), {
    recursive: true,
  });

  try {
    await knex.raw("PRAGMA foreign_keys = OFF");
    await knex.schema.createTable("o_skillList", (table) => table.text("id").primary());
    await initDB(knex);

    await knex.schema.alterTable("o_project", (table) => {
      table.string("mode");
      table.string("videoModel");
      table.dropColumns("videoVendorId", "videoModelId", "videoCapabilityId", "videoOutputPresetId");
    });
    await knex.schema.alterTable("o_videoTrack", (table) => {
      table.text("prompt");
      table.dropColumns("vendorId", "modelId", "capabilityId", "inputRefs", "outputSelection", "promptRevisionId");
    });
    await knex.schema.alterTable("o_video", (table) => table.dropColumns("generationTaskId", "artifactRevisionId"));
    await knex.schema.dropTable("o_artifactRevision");
    await knex.schema.dropTable("o_promptRevision");
    await knex.schema.dropTable("o_generationTask");
    await knex.schema.dropTable("o_productionAction");
    await knex("o_vendorConfig").insert({ id: "openai", inputValues: "{}", models: "[]", enable: 0 });
    await knex("o_prompt").insert({ type: "videoPromptGeneration", name: "legacy", data: "mode router" });

    // Application readiness runs these in this order.
    await initDB(knex);
    await fixDB(knex, dataRoot);

    const projectColumns = await knex("o_project").columnInfo();
    assert.ok(projectColumns.videoCapabilityId);
    assert.equal(projectColumns.mode, undefined);
    assert.equal(projectColumns.videoModel, undefined);
    const trackColumns = await knex("o_videoTrack").columnInfo();
    assert.ok(trackColumns.inputRefs);
    assert.equal(trackColumns.prompt, undefined);
    assert.equal(await knex.schema.hasTable("o_generationTask"), true);
    assert.equal(await knex.schema.hasTable("o_artifactRevision"), true);
    assert.equal(await knex("o_vendorConfig").where("id", "openai").first(), undefined);
    assert.ok(await knex("o_vendorConfig").where("id", "deepseek").first());
    assert.equal(await knex("o_prompt").where("type", "videoPromptGeneration").first(), undefined);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
