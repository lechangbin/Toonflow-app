import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { closeDatabase, getDatabaseRuntime, openDatabase } from "../src/database";
import { openSqliteFile, withDataRoot } from "./databaseTestSupport";

const READINESS_PREFIX = "toonflow-readiness-";

type ColumnInfo = Record<string, unknown>;

/**
 * A database in the shape the application shipped before the Video capability
 * columns existed: legacy `o_project.videoModel` / `o_project.mode` and
 * `o_videoTrack.prompt`, and an `o_setting` created before `tokenKey` was
 * introduced.
 */
async function createLegacyDatabase(databaseFile: string): Promise<void> {
  const legacy = openSqliteFile(databaseFile);
  try {
    await legacy.schema.createTable("o_setting", (table) => {
      table.text("key");
      table.text("value");
      table.primary(["key"]);
    });
    await legacy("o_setting").insert([{ key: "messagesPerSummary", value: "10" }]);

    await legacy.schema.createTable("o_project", (table) => {
      table.integer("id");
      table.text("name");
      table.string("videoModel");
      table.string("mode");
      table.primary(["id"]);
    });
    await legacy("o_project").insert([{ id: 7, name: "旧项目", videoModel: "legacy-model", mode: "legacy-mode" }]);

    await legacy.schema.createTable("o_videoTrack", (table) => {
      table.integer("id");
      table.integer("projectId");
      table.text("prompt");
      table.string("state");
      table.text("reason");
      table.primary(["id"]);
    });
    await legacy("o_videoTrack").insert([{ id: 11, projectId: 7, prompt: "旧提示词", state: "已完成" }]);
  } finally {
    await legacy.destroy();
  }
}

/** Production work left mid-flight by a process that was killed. */
async function createInterruptedDatabase(databaseFile: string): Promise<void> {
  const legacy = openSqliteFile(databaseFile);
  try {
    await legacy.schema.createTable("o_productionAction", (table) => {
      table.integer("id").notNullable();
      table.integer("projectId").notNullable();
      table.string("actionType").notNullable();
      table.string("requestedBy").notNullable();
      table.string("status").notNullable();
      table.integer("createdAt").notNullable();
      table.integer("completedAt");
      table.primary(["id"]);
    });
    await legacy.schema.createTable("o_generationTask", (table) => {
      table.integer("id").notNullable();
      table.integer("actionId").notNullable();
      table.integer("projectId").notNullable();
      table.integer("videoTrackId").notNullable();
      table.string("vendorId").notNullable();
      table.string("modelId").notNullable();
      table.string("capabilityId").notNullable();
      table.integer("promptRevisionId").notNullable();
      table.text("commandSnapshot").notNullable();
      table.string("status").notNullable();
      table.integer("artifactRevisionId");
      table.integer("startedAt").notNullable();
      table.integer("completedAt");
      table.text("error");
      table.primary(["id"]);
    });
    await legacy.schema.createTable("o_videoTrack", (table) => {
      table.integer("id").notNullable();
      table.integer("projectId").notNullable();
      table.string("state");
      table.text("reason");
      table.primary(["id"]);
    });
    await legacy.schema.createTable("o_artifactRevision", (table) => {
      table.integer("id").notNullable();
      table.integer("actionId").notNullable();
      table.integer("generationTaskId").notNullable();
      table.integer("videoId").notNullable();
      table.integer("videoTrackId").notNullable();
      table.integer("revision").notNullable();
      table.string("status").notNullable();
      table.integer("createdAt").notNullable();
      table.primary(["id"]);
    });
    await legacy.schema.createTable("o_video", (table) => {
      table.integer("id").notNullable();
      table.string("state");
      table.text("errorReason");
      table.primary(["id"]);
    });

    await legacy("o_productionAction").insert([
      { id: 1, projectId: 1, actionType: "video.generate", requestedBy: "user", status: "running", createdAt: 1 },
      { id: 8, projectId: 1, actionType: "video.generate", requestedBy: "user", status: "succeeded", createdAt: 1 },
    ]);
    await legacy("o_generationTask").insert([
      {
        id: 2,
        actionId: 1,
        projectId: 1,
        videoTrackId: 3,
        vendorId: "agnes",
        modelId: "agnes-video-v2.0",
        capabilityId: "text-to-video",
        promptRevisionId: 4,
        commandSnapshot: "{}",
        status: "running",
        startedAt: 1,
      },
      {
        id: 9,
        actionId: 8,
        projectId: 1,
        videoTrackId: 10,
        vendorId: "agnes",
        modelId: "agnes-video-v2.0",
        capabilityId: "text-to-video",
        promptRevisionId: 4,
        commandSnapshot: "{}",
        status: "succeeded",
        startedAt: 1,
      },
    ]);
    await legacy("o_videoTrack").insert([
      { id: 3, projectId: 1, state: "生成中" },
      { id: 10, projectId: 1, state: "已完成" },
    ]);
    await legacy("o_artifactRevision").insert([
      { id: 5, actionId: 1, generationTaskId: 2, videoId: 6, videoTrackId: 3, revision: 1, status: "draft", createdAt: 1 },
      { id: 12, actionId: 8, generationTaskId: 9, videoId: 13, videoTrackId: 10, revision: 1, status: "accepted", createdAt: 1 },
    ]);
    await legacy("o_video").insert([
      { id: 6, state: "生成中" },
      { id: 13, state: "生成成功" },
    ]);
  } finally {
    await legacy.destroy();
  }
}

test("fresh startup opens a ready runtime with the current schema and required defaults", async () => {
  await withDataRoot(READINESS_PREFIX, async (dataRoot) => {
    const runtime = await openDatabase();

    assert.equal(runtime.state, "ready");
    assert.equal(getDatabaseRuntime(), runtime);
    assert.equal(fs.existsSync(path.join(dataRoot, "db2.sqlite")), true, "the database file is created");
    assert.equal(fs.existsSync(path.join(dataRoot, "vendor", "agnes.ts")), true, "Vendor sources are reconciled");

    const settings = await runtime.work((database) => database("o_setting").select("key", "value"));
    const tokenKeys = settings.filter((setting) => setting.key === "tokenKey");
    assert.equal(tokenKeys.length, 1, "the required tokenKey default exists exactly once");
    assert.ok(String(tokenKeys[0].value).length > 0);

    const vendors = await runtime.work((database) => database("o_vendorConfig").select("id"));
    assert.deepEqual(
      vendors.map((vendor: { id: string }) => vendor.id).sort(),
      ["agnes", "deepseek", "minimax", "volcengine", "volcengineSd2"],
    );

    const users = await runtime.work((database) => database("o_user").select("id"));
    assert.equal(users.length, 1, "fresh seed data is written exactly once");
  });
});

test("a known legacy database is upgraded and its required defaults are reconciled", async () => {
  await withDataRoot(READINESS_PREFIX, async (dataRoot) => {
    await createLegacyDatabase(path.join(dataRoot, "db2.sqlite"));
    const runtime = await openDatabase();
    assert.equal(runtime.state, "ready");

    const tokenKey = await runtime.work((database) => database("o_setting").where("key", "tokenKey").first());
    assert.ok(tokenKey, "a legacy o_setting without tokenKey gains the required default");
    assert.ok(String(tokenKey.value).length > 0);

    const projectColumns = await runtime.work(
      (database) => database("o_project").columnInfo() as Promise<ColumnInfo>,
    );
    assert.equal("videoModel" in projectColumns, false, "the dropped legacy column is removed");
    assert.equal("mode" in projectColumns, false, "the dropped legacy column is removed");
    assert.equal("videoVendorId" in projectColumns, true, "the upgrade adds the capability columns");
    assert.equal("videoCapabilityId" in projectColumns, true, "the upgrade adds the capability columns");

    const trackColumns = await runtime.work(
      (database) => database("o_videoTrack").columnInfo() as Promise<ColumnInfo>,
    );
    assert.equal("prompt" in trackColumns, false, "the dropped legacy prompt column is removed");
    assert.equal("vendorId" in trackColumns, true);
    assert.equal("promptRevisionId" in trackColumns, true);

    const project = await runtime.work((database) => database("o_project").where("id", 7).first());
    assert.equal(project.name, "旧项目", "legacy rows survive the upgrade");
  });
});

test("interrupted production work is recovered through the readiness lifecycle", async () => {
  await withDataRoot(READINESS_PREFIX, async (dataRoot) => {
    await createInterruptedDatabase(path.join(dataRoot, "db2.sqlite"));
    const runtime = await openDatabase();
    assert.equal(runtime.state, "ready");

    const action = await runtime.work((database) => database("o_productionAction").where("id", 1).first());
    assert.equal(action.status, "failed");
    assert.ok(action.completedAt > 0);

    const task = await runtime.work((database) => database("o_generationTask").where("id", 2).first());
    assert.equal(task.status, "failed");
    assert.equal(task.error, "软件退出导致失败");

    const track = await runtime.work((database) => database("o_videoTrack").where("id", 3).first());
    assert.equal(track.state, "生成失败");
    assert.equal(track.reason, "软件退出导致失败");

    const revision = await runtime.work((database) => database("o_artifactRevision").where("id", 5).first());
    assert.equal(revision.status, "rejected");

    const video = await runtime.work((database) => database("o_video").where("id", 6).first());
    assert.equal(video.state, "生成失败");
    assert.equal(video.errorReason, "软件退出导致失败");

    const finishedAction = await runtime.work((database) => database("o_productionAction").where("id", 8).first());
    assert.equal(finishedAction.status, "succeeded", "completed work is untouched");
    const accepted = await runtime.work((database) => database("o_artifactRevision").where("id", 12).first());
    assert.equal(accepted.status, "accepted", "accepted revisions are untouched");
  });
});

test("concurrent opening is single-flight and shares one runtime", async () => {
  await withDataRoot(READINESS_PREFIX, async () => {
    const [first, second, third] = await Promise.all([openDatabase(), openDatabase(), openDatabase()]);

    assert.equal(first, second, "concurrent callers share one runtime");
    assert.equal(second, third, "concurrent callers share one runtime");
    assert.equal(getDatabaseRuntime(), first);
    assert.equal(first.state, "ready");

    // A second concurrent lifecycle would race the unique seed inserts in
    // o_setting / o_user and fail, so a clean single seed proves it ran once.
    const tokenKeys = await first.work((database) => database("o_setting").where("key", "tokenKey").select("key"));
    assert.equal(tokenKeys.length, 1);
    const users = await first.work((database) => database("o_user").select("id"));
    assert.equal(users.length, 1);
  });
});

test("a failed revalidation leaves the runtime unavailable instead of serving work", async () => {
  await withDataRoot(READINESS_PREFIX, async (dataRoot) => {
    const runtime = await openDatabase();
    assert.equal(runtime.state, "ready");

    // Break a required runtime invariant that the upgrade path cannot repair.
    fs.rmSync(path.join(dataRoot, "promptProfiles"), { recursive: true, force: true });

    await assert.rejects(() => runtime.maintenance({ kind: "verify" }));
    assert.equal(runtime.state, "unavailable");
    await assert.rejects(() => runtime.work((database) => database("o_setting").select("key")), /数据库不可用/);
    await assert.rejects(() => runtime.maintenance({ kind: "verify" }), /数据库不可用/);
  });
});

test("closing releases the runtime and permits a fresh reopen", async () => {
  await withDataRoot(READINESS_PREFIX, async () => {
    const runtime = await openDatabase();
    await runtime.close();

    assert.equal(runtime.state, "closed");
    await assert.rejects(() => runtime.work((database) => database("o_setting").select("key")), /数据库已关闭/);
    assert.throws(() => getDatabaseRuntime(), /数据库尚未就绪/);

    const reopened = await openDatabase();
    assert.notEqual(reopened, runtime, "a reopen runs the lifecycle again");
    assert.equal(reopened.state, "ready");
    const settings = await reopened.work((database) => database("o_setting").select("key"));
    assert.ok(settings.length > 0);
  });
});

test("closeDatabase is a no-op when no runtime is open", async () => {
  await assert.doesNotReject(() => closeDatabase());
});
