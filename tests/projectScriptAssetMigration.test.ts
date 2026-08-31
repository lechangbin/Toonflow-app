import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express, { type Router } from "express";

import { openDatabase } from "../src/database";
import { withDataRoot } from "./databaseTestSupport";

import getSingleProjectRoute from "../src/routes/general/getSingleProject";
import addAssetsRoute from "../src/routes/assets/addAssets";
import addScriptRoute from "../src/routes/script/addScript";

const MIGRATION_PREFIX = "toonflow-migration-";

function createApp(router: Router): express.Express {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ message: error.message });
  });
  return app;
}

async function postJson(app: express.Express, body: unknown): Promise<{ status: number; body: any }> {
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("migrated read routes resolve through the shared readiness lease", async () => {
  await withDataRoot(MIGRATION_PREFIX, async () => {
    const runtime = await openDatabase();
    await runtime.work(async (db) => {
      await db("o_project").insert({ id: 42, name: "测试项目" });
    });

    const { status, body } = await postJson(createApp(getSingleProjectRoute), { id: 42 });

    assert.equal(status, 200);
    assert.equal(body.code, 200);
    assert.ok(Array.isArray(body.data), "getSingleProject returns the matching project rows");
    assert.equal(body.data[0].name, "测试项目");
  });
});

test("migrated write routes persist through the shared readiness lease", async () => {
  await withDataRoot(MIGRATION_PREFIX, async () => {
    const runtime = await openDatabase();

    const { status, body } = await postJson(createApp(addAssetsRoute), {
      name: "角色A",
      describe: "主角",
      type: "role",
      projectId: 42,
    });

    assert.equal(status, 200);
    assert.equal(body.data.message, "新增资产成功");

    const rows = await runtime.work(async (db) => {
      return await db("o_assets").where("name", "角色A").select("type", "projectId");
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "role");
    assert.equal(rows[0].projectId, 42);
  });
});

test("migrated multi-statement flows write related rows under one shared lease", async () => {
  await withDataRoot(MIGRATION_PREFIX, async () => {
    const runtime = await openDatabase();
    await runtime.work(async (db) => {
      await db("o_project").insert({ id: 42, name: "测试项目" });
      await db("o_assets").insert({ id: 1, name: "角色A", type: "role", projectId: 42 });
    });

    const { status, body } = await postJson(createApp(addScriptRoute), {
      name: "第一集",
      content: "剧本内容",
      projectId: 42,
      assets: [1],
    });

    assert.equal(status, 200);
    assert.equal(body.data.message, "添加剧本成功");

    const scripts = await runtime.work(async (db) => {
      return await db("o_script").where("name", "第一集").select("id", "projectId");
    });
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].projectId, 42);

    const links = await runtime.work(async (db) => {
      return await db("o_scriptAssets").where("assetId", 1).select("scriptId");
    });
    assert.equal(links.length, 1, "the script-asset link is written in the same flow");
    assert.equal(links[0].scriptId, scripts[0].id);
  });
});
