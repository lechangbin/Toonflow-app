import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { uploadVideoInputImage } from "../src/video/inputUpload";
import { workOf } from "./databaseTestSupport";

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpegSignature = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const webpSignature = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

function dataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function setupOwnedDb() {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_project", (table) => table.integer("id").primary());
  await db.schema.createTable("o_script", (table) => {
    table.integer("id").primary();
    table.integer("projectId");
  });
  await db("o_project").insert({ id: 1 });
  await db("o_script").insert({ id: 2, projectId: 1 });
  return db;
}

test("a Project/Script-scoped image upload returns a persistable relative filePath and display URL", async () => {
  const db = await setupOwnedDb();
  let written: { filePath: string; bytes: Buffer } | undefined;
  try {
    const result = await uploadVideoInputImage(
      {
        db: workOf(db),
        createId: () => "fixed-id",
        writeFile: async (filePath, bytes) => {
          written = { filePath, bytes };
        },
        getFileUrl: async (filePath) => `/oss${filePath}`,
      },
      { projectId: 1, scriptId: 2, base64Data: dataUrl("image/png", pngSignature) },
    );

    assert.deepEqual(result, {
      filePath: "/1/video-inputs/2/fixed-id.png",
      url: "/oss/1/video-inputs/2/fixed-id.png",
    });
    assert.equal(written?.filePath, result.filePath);
    assert.deepEqual(written?.bytes, pngSignature);
  } finally {
    await db.destroy();
  }
});

test("a Video input upload rejects a Script owned by another Project before writing", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_project", (table) => table.integer("id").primary());
  await db.schema.createTable("o_script", (table) => {
    table.integer("id").primary();
    table.integer("projectId");
  });
  await db("o_project").insert([{ id: 1 }, { id: 9 }]);
  await db("o_script").insert({ id: 2, projectId: 9 });
  let wrote = false;
  try {
    await assert.rejects(
      uploadVideoInputImage(
        {
          db: workOf(db),
          createId: () => "fixed-id",
          writeFile: async () => {
            wrote = true;
          },
          getFileUrl: async (filePath) => filePath,
        },
        { projectId: 1, scriptId: 2, base64Data: dataUrl("image/png", pngSignature) },
      ),
      /Script 2 不属于 Project 1/,
    );
    assert.equal(wrote, false);
  } finally {
    await db.destroy();
  }
});

test("a corrupt or unrecognised image payload is rejected before the file is written", async () => {
  const db = await setupOwnedDb();
  let wrote = false;
  try {
    await assert.rejects(
      uploadVideoInputImage(
        {
          db: workOf(db),
          createId: () => "fixed-id",
          writeFile: async () => {
            wrote = true;
          },
          getFileUrl: async (filePath) => filePath,
        },
        { projectId: 1, scriptId: 2, base64Data: dataUrl("image/png", Buffer.from("not-a-real-image")) },
      ),
      /损坏或格式不支持/,
    );
    assert.equal(wrote, false);
  } finally {
    await db.destroy();
  }
});

test("the saved extension follows the real magic bytes, not the declared data URL MIME", async () => {
  const db = await setupOwnedDb();
  let written: { filePath: string; bytes: Buffer } | undefined;
  try {
    const result = await uploadVideoInputImage(
      {
        db: workOf(db),
        createId: () => "fixed-id",
        writeFile: async (filePath, bytes) => {
          written = { filePath, bytes };
        },
        getFileUrl: async (filePath) => `/oss${filePath}`,
      },
      { projectId: 1, scriptId: 2, base64Data: dataUrl("image/png", jpegSignature) },
    );
    assert.equal(result.filePath, "/1/video-inputs/2/fixed-id.jpg");
    assert.deepEqual(written?.bytes, jpegSignature);
  } finally {
    await db.destroy();
  }
});

test("WebP magic bytes are accepted and saved with the webp extension", async () => {
  const db = await setupOwnedDb();
  let written: { filePath: string; bytes: Buffer } | undefined;
  try {
    const result = await uploadVideoInputImage(
      {
        db: workOf(db),
        createId: () => "fixed-id",
        writeFile: async (filePath, bytes) => {
          written = { filePath, bytes };
        },
        getFileUrl: async (filePath) => `/oss${filePath}`,
      },
      { projectId: 1, scriptId: 2, base64Data: dataUrl("image/webp", webpSignature) },
    );
    assert.equal(result.filePath, "/1/video-inputs/2/fixed-id.webp");
    assert.deepEqual(written?.bytes, webpSignature);
  } finally {
    await db.destroy();
  }
});
