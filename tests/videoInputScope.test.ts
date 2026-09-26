import assert from "node:assert/strict";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import { resolveVideoInputPath } from "../src/video/inputResolution";

async function database(): Promise<Knex> {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_storyboard", (t) => {
    t.integer("id").primary(); t.integer("projectId");
    t.integer("scriptId"); t.text("filePath");
  });
  await db.schema.createTable("o_assets", (t) => {
    t.integer("id").primary(); t.integer("projectId");
    t.integer("scriptId"); t.integer("imageId");
  });
  await db.schema.createTable("o_scriptAssets", (t) => {
    t.integer("scriptId"); t.integer("assetId");
  });
  await db.schema.createTable("o_image", (t) => {
    t.integer("id").primary(); t.text("filePath");
  });
  await db("o_storyboard").insert([
    { id: 21, projectId: 7, scriptId: 11, filePath: "/7/storyboard.png" },
    { id: 22, projectId: 8, scriptId: 12, filePath: "/8/storyboard.png" },
  ]);
  await db("o_assets").insert([
    { id: 31, projectId: 7, scriptId: 11, imageId: 41 },
    { id: 32, projectId: 8, scriptId: 12, imageId: 42 },
    { id: 33, projectId: 7, scriptId: 13, imageId: 43 },
  ]);
  await db("o_image").insert([
    { id: 41, filePath: "/7/asset.png" },
    { id: 42, filePath: "/8/asset.png" },
    { id: 43, filePath: "/7/linked-asset.png" },
  ]);
  return db;
}

test("Video generation resolves only same-Project and same-Script Storyboards", async () => {
  const db = await database();
  try {
    assert.equal(await resolveVideoInputPath(db,
      { role: "source-image", source: "storyboard", sourceId: 21 }, 7, 11),
    "/7/storyboard.png");
    await assert.rejects(resolveVideoInputPath(db,
      { role: "source-image", source: "storyboard", sourceId: 22 }, 7, 11));
    await assert.rejects(resolveVideoInputPath(db,
      { role: "source-image", source: "storyboard", sourceId: 21 }, 7, 13));
  } finally { await db.destroy(); }
});

test("Video generation resolves only same-Project Assets tied to the Script", async () => {
  const db = await database();
  try {
    assert.equal(await resolveVideoInputPath(db,
      { role: "source-image", source: "asset", sourceId: 31 }, 7, 11),
    "/7/asset.png");
    await assert.rejects(resolveVideoInputPath(db,
      { role: "source-image", source: "asset", sourceId: 32 }, 7, 11));
    await assert.rejects(resolveVideoInputPath(db,
      { role: "source-image", source: "asset", sourceId: 33 }, 7, 11));
    await db("o_scriptAssets").insert({ scriptId: 11, assetId: 33 });
    assert.equal(await resolveVideoInputPath(db,
      { role: "source-image", source: "asset", sourceId: 33 }, 7, 11),
    "/7/linked-asset.png");
  } finally { await db.destroy(); }
});

test("uploaded Video image path must be an upload in the exact Project and Script", async () => {
  const db = await database();
  try {
    const path = (filePath: string) => resolveVideoInputPath(db,
      { role: "source-image", source: "uploaded-media", filePath }, 7, 11);
    assert.equal(await path("/7/video-inputs/11/fixed-id.png"),
      "/7/video-inputs/11/fixed-id.png");
    for (const invalid of ["/8/video-inputs/12/fixed-id.png",
      "/7/video-inputs/12/fixed-id.png", "/7/video-inputs/11/../secret.png",
      "/7/storyboard.png", "C:/7/video-inputs/11/image.png"]) {
      await assert.rejects(path(invalid));
    }
  } finally { await db.destroy(); }
});
