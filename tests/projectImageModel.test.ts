import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import knex from "knex";
import { createSetImageModelRouter } from "../src/routes/project/setImageModel";
import { workOf } from "./databaseTestSupport";

test("image model preference survives a new read, rejects invalid choices and preserves other project fields", async () => {
  const db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_project", table => { table.integer("id").primary(); table.text("imageModel"); table.text("name"); });
  await db("o_project").insert({ id: 1, imageModel: "agnes:old", name: "unchanged" });
  const router = createSetImageModelRouter(workOf(db), async () => ({ vendorId: "agnes", name: "Agnes", inputs: [], models: [
    { type: "image", name: "Image 2.5", modelName: "agnes-image-2.5-flash", mode: ["text"] },
  ] }));
  const app = express();
  app.use(express.json()); app.use(router);
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address(); assert(address && typeof address === "object");
    const post = (body: object) => fetch(`http://127.0.0.1:${address.port}/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post({ projectId: 1, imageModel: "agnes:agnes-image-2.5-flash" })).status, 200);
    assert.deepEqual(await db("o_project").where({ id: 1 }).first(), { id: 1, imageModel: "agnes:agnes-image-2.5-flash", name: "unchanged" });
    assert.equal((await post({ projectId: 1, imageModel: "agnes:missing" })).status, 400);
    assert.equal((await post({ projectId: 999, imageModel: "agnes:agnes-image-2.5-flash" })).status, 404);
    assert.equal((await post({ projectId: 1, imageModel: "invalid" })).status, 400);
    assert.equal((await db("o_project").where({ id: 1 }).first()).imageModel, "agnes:agnes-image-2.5-flash");
  } finally {
    server.close(); await once(server, "close"); await db.destroy();
  }
});
