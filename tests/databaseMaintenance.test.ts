import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import express from "express";

import { MaintenanceValidationError, openDatabase } from "../src/database";
import clearDataRoute from "../src/routes/setting/dbConfig/clearData";
import clearTableRoute from "../src/routes/setting/dbConfig/clearTable";
import importDataRoute from "../src/routes/setting/dbConfig/importData";
import { withDataRoot } from "./databaseTestSupport";

const MAINTENANCE_PREFIX = "toonflow-maintenance-";

async function readForeignKeys(runtime: Awaited<ReturnType<typeof openDatabase>>): Promise<number> {
  const rows = (await runtime.work((database) => database.raw("PRAGMA foreign_keys"))) as Array<{
    foreign_keys: number;
  }>;
  return rows[0].foreign_keys;
}

async function withServer(
  routes: Record<string, express.Router>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  for (const [path, router] of Object.entries(routes)) {
    app.use(path, router);
  }
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("import preflight rejects malformed, unknown, and unsupported backups without modifying the database", async () => {
  await withDataRoot(MAINTENANCE_PREFIX, async () => {
    const runtime = await openDatabase();

    await assert.rejects(
      () => runtime.maintenance({ kind: "import", tables: ["not", "an", "object"] }),
      (error: unknown) => error instanceof MaintenanceValidationError && error.message === "无效的导入数据格式",
    );
    assert.equal(runtime.state, "ready", "a preflight rejection leaves the runtime ready");

    await assert.rejects(
      () => runtime.maintenance({ kind: "import", tables: { o_does_not_exist: [] } }),
      (error: unknown) => error instanceof MaintenanceValidationError && error.message === "未知的表: o_does_not_exist",
    );
    assert.equal(runtime.state, "ready");

    await assert.rejects(
      () => runtime.maintenance({ kind: "import", tables: { o_project: "not-an-array" } }),
      (error: unknown) => error instanceof MaintenanceValidationError && error.message === "备份数据格式不受支持",
    );
    await assert.rejects(
      () => runtime.maintenance({ kind: "import", tables: { o_project: ["not-a-row"] } }),
      (error: unknown) => error instanceof MaintenanceValidationError && error.message === "备份数据格式不受支持",
    );
    assert.equal(runtime.state, "ready");

    const settings = await runtime.work((database) => database("o_setting").select("key"));
    assert.ok(settings.length > 0, "the live database was not modified by any rejected import");
  });
});

test("import upgrades a known legacy backup through the same readiness lifecycle", async () => {
  await withDataRoot(MAINTENANCE_PREFIX, async () => {
    const runtime = await openDatabase();

    const result = await runtime.maintenance({
      kind: "import",
      tables: {
        o_setting: [{ key: "messagesPerSummary", value: "10" }],
        o_project: [{ id: 7, name: "旧项目", videoModel: "legacy-model", mode: "legacy-mode" }],
      },
    });

    assert.deepEqual(result, { kind: "import", imported: true, tableCount: 2 });
    assert.equal(runtime.state, "ready");

    const tokenKey = await runtime.work((database) => database("o_setting").where("key", "tokenKey").first());
    assert.ok(tokenKey, "the required tokenKey default is reconciled after import");
    assert.ok(String(tokenKey.value).length > 0);

    const projectColumns = await runtime.work((database) => database("o_project").columnInfo() as Promise<Record<string, unknown>>);
    assert.equal("videoModel" in projectColumns, false, "the legacy videoModel column is gone");
    assert.equal("mode" in projectColumns, false, "the legacy mode column is gone");
    assert.equal("videoVendorId" in projectColumns, true, "the capability column exists");

    const project = await runtime.work((database) => database("o_project").where("id", 7).first());
    assert.equal(project.name, "旧项目", "legacy rows survive the import");
  });
});

test("reset clears all user data and restores required defaults and readiness", async () => {
  await withDataRoot(MAINTENANCE_PREFIX, async () => {
    const runtime = await openDatabase();

    await runtime.work((database) => database("o_setting").where("key", "tokenKey").delete());
    await runtime.work((database) => database("o_project").insert({ id: 999, name: "污染数据" }));

    const result = await runtime.maintenance({ kind: "reset" });
    assert.deepEqual(result, { kind: "reset", reset: true });
    assert.equal(runtime.state, "ready");

    const tokenKey = await runtime.work((database) => database("o_setting").where("key", "tokenKey").first());
    assert.ok(tokenKey, "reset restores the required default");

    const projects = await runtime.work((database) => database("o_project").select("id"));
    assert.equal(projects.some((row: { id: number }) => row.id === 999), false, "reset removes all user data");

    const users = await runtime.work((database) => database("o_user").select("id"));
    assert.equal(users.length, 1, "reset restores the fresh seed");
  });
});

test("clearing o_setting restores the required default through readiness", async () => {
  await withDataRoot(MAINTENANCE_PREFIX, async () => {
    const runtime = await openDatabase();

    const result = await runtime.maintenance({ kind: "clearTable", tableName: "o_setting" });
    assert.deepEqual(result, { kind: "clearTable", clearedTable: "o_setting" });
    assert.equal(runtime.state, "ready");

    const rows = await runtime.work((database) => database("o_setting").select("key"));
    const keys = rows.map((row: { key: string }) => row.key);
    assert.ok(keys.includes("tokenKey"), "the required tokenKey default is restored after clearing o_setting");
    const tokenKey = await runtime.work((database) => database("o_setting").where("key", "tokenKey").first());
    assert.ok(String(tokenKey.value).length > 0);
  });
});

test("clearTable rejects a missing or unknown table before mutation", async () => {
  await withDataRoot(MAINTENANCE_PREFIX, async () => {
    const runtime = await openDatabase();

    await assert.rejects(
      () => runtime.maintenance({ kind: "clearTable", tableName: "" }),
      (error: unknown) => error instanceof MaintenanceValidationError && error.message === "请提供有效的表名",
    );
    await assert.rejects(
      () => runtime.maintenance({ kind: "clearTable", tableName: "o_nope" }),
      (error: unknown) => error instanceof MaintenanceValidationError && error.message === "表不存在",
    );
    assert.equal(runtime.state, "ready");
  });
});

test("a failed import rolls back and revalidates the prior state instead of going unavailable", async () => {
  await withDataRoot(MAINTENANCE_PREFIX, async () => {
    const runtime = await openDatabase();
    const beforeUsers = await runtime.work((database) => database("o_user").select("id"));

    // Duplicate primary key makes the insert fail after the destructive rebuild
    // began, so the transaction must roll back to the prior state.
    await assert.rejects(() =>
      runtime.maintenance({
        kind: "import",
        tables: { o_user: [{ id: 1, name: "a" }, { id: 1, name: "b" }] },
      }),
    );

    assert.equal(runtime.state, "ready", "a rolled-back mutation revalidates to ready");
    const afterUsers = await runtime.work((database) => database("o_user").select("id"));
    assert.deepEqual(
      afterUsers.map((row: { id: number }) => row.id).sort(),
      beforeUsers.map((row: { id: number }) => row.id).sort(),
      "the prior data is restored",
    );
    const tokenKey = await runtime.work((database) => database("o_setting").where("key", "tokenKey").first());
    assert.ok(tokenKey);
  });
});

test("maintenance restores the foreign-key pragma on both success and rollback paths", async () => {
  await withDataRoot(MAINTENANCE_PREFIX, async () => {
    const runtime = await openDatabase();

    // Force a non-default pragma so restoration is observable.
    await runtime.work((database) => database.raw("PRAGMA foreign_keys = ON"));
    assert.equal(await readForeignKeys(runtime), 1);

    await runtime.maintenance({ kind: "reset" });
    assert.equal(await readForeignKeys(runtime), 1, "a successful reset restores the prior pragma");

    await assert.rejects(() =>
      runtime.maintenance({ kind: "import", tables: { o_user: [{ id: 1, name: "a" }, { id: 1, name: "b" }] } }),
    );
    assert.equal(await readForeignKeys(runtime), 1, "a rolled-back import restores the prior pragma");
  });
});

test("a destructive command whose revalidation fails leaves the runtime unavailable", async () => {
  await withDataRoot(MAINTENANCE_PREFIX, async (dataRoot) => {
    const runtime = await openDatabase();

    // Break a runtime invariant that readiness can only detect during validate.
    fs.rmSync(path.join(dataRoot, "promptProfiles"), { recursive: true, force: true });

    await assert.rejects(() => runtime.maintenance({ kind: "reset" }));
    assert.equal(runtime.state, "unavailable", "a failed revalidation keeps the runtime unavailable");
  });
});

test("importData route preserves its path, status codes, envelope, and messages", async () => {
  await withDataRoot(MAINTENANCE_PREFIX, async () => {
    await openDatabase();
    await withServer({ "/api/setting/dbConfig/importData": importDataRoute }, async (base) => {
      const url = `${base}/api/setting/dbConfig/importData`;

      const bad = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tables: ["not", "an", "object"] }),
      });
      assert.equal(bad.status, 400);
      assert.deepEqual(await bad.json(), { code: 400, data: null, message: "无效的导入数据格式" });

      const ok = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tables: {} }),
      });
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), { code: 200, data: "数据库导入成功", message: "成功" });
    });
  });
});

test("clearTable route preserves its path, status codes, envelope, and messages", async () => {
  await withDataRoot(MAINTENANCE_PREFIX, async () => {
    await openDatabase();
    await withServer({ "/api/setting/dbConfig/clearTable": clearTableRoute }, async (base) => {
      const url = `${base}/api/setting/dbConfig/clearTable`;
      const post = (body: unknown) =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });

      const missing = await post({});
      assert.equal(missing.status, 400);
      assert.deepEqual(await missing.json(), { code: 400, data: null, message: "请提供有效的表名" });

      const notFound = await post({ tableName: "o_nope" });
      assert.equal(notFound.status, 400);
      assert.deepEqual(await notFound.json(), { code: 400, data: null, message: "表不存在" });

      const ok = await post({ tableName: "o_project" });
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), { code: 200, data: "表 o_project 已清空", message: "成功" });
    });
  });
});

test("clearData (reset) route preserves its path, status codes, envelope, and messages", async () => {
  await withDataRoot(MAINTENANCE_PREFIX, async () => {
    await openDatabase();
    await withServer({ "/api/setting/dbConfig/clearData": clearDataRoute }, async (base) => {
      const url = `${base}/api/setting/dbConfig/clearData`;
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { code: 200, data: "数据库已清空并重新初始化", message: "成功" });
    });
  });
});
