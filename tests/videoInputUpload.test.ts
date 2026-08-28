import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { uploadVideoInputImage } from "../src/video/inputUpload";

test("a Project/Script-scoped image upload returns a persistable relative filePath and display URL", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_project", (table) => table.integer("id").primary());
  await db.schema.createTable("o_script", (table) => {
    table.integer("id").primary();
    table.integer("projectId");
  });
  await db("o_project").insert({ id: 1 });
  await db("o_script").insert({ id: 2, projectId: 1 });
  let written: { filePath: string; bytes: Buffer } | undefined;

  try {
    const result = await uploadVideoInputImage(
      {
        db,
        createId: () => "fixed-id",
        writeFile: async (filePath, bytes) => {
          written = { filePath, bytes };
        },
        getFileUrl: async (filePath) => `/oss${filePath}`,
      },
      {
        projectId: 1,
        scriptId: 2,
        base64Data: "data:image/png;base64,aGVsbG8=",
      },
    );

    assert.deepEqual(result, {
      filePath: "/1/video-inputs/2/fixed-id.png",
      url: "/oss/1/video-inputs/2/fixed-id.png",
    });
    assert.equal(written?.filePath, result.filePath);
    assert.equal(written?.bytes.toString("utf8"), "hello");
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
          db,
          createId: () => "fixed-id",
          writeFile: async () => {
            wrote = true;
          },
          getFileUrl: async (filePath) => filePath,
        },
        { projectId: 1, scriptId: 2, base64Data: "data:image/png;base64,aGVsbG8=" },
      ),
      /Script 2 不属于 Project 1/,
    );
    assert.equal(wrote, false);
  } finally {
    await db.destroy();
  }
});
