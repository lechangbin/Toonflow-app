import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import initDB from "../src/lib/initDB";
import fixDB from "../src/lib/fixDB";
import { workOf } from "./databaseTestSupport";
import {
  ASSET_REFERENCE_ANALYSIS_NOT_REQUESTED,
  ASSET_REFERENCE_ANALYSIS_STATES,
  ASSET_REFERENCE_LIMIT,
  ASSET_REFERENCE_MANUAL_SOURCE,
  assetReferenceErrorEnvelope,
  createAssetReference,
  deleteAssetReference,
  listAssetReferences,
  removeAssetReferencesForAssets,
  reorderAssetReferences,
  updateAssetReference,
  type AssetReferenceMediaStore,
} from "../src/assets/assetReferences";
import { analyzeAssetReference } from "../src/assets/assetReferenceAnalysis";
import { detectImageMime } from "../src/assets/assetReferenceMedia";

function createTemporaryDatabase(prefix: string): { directory: string; knex: Knex } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const databasePath = path.join(directory, "db.sqlite");
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: databasePath },
    useNullAsDefault: true,
  });
  return { directory, knex };
}

async function prepareSchema(knex: Knex): Promise<void> {
  await knex.raw("PRAGMA foreign_keys = OFF");
  // 预置 o_skillList，避免触发与本次契约无关的向量初始化
  await knex.schema.createTable("o_skillList", (table) => table.text("id").primary());
  await initDB(knex);
}

async function seedProjectAndAssets(knex: Knex): Promise<void> {
  await knex("o_project").insert([
    { id: 1, name: "项目一" },
    { id: 2, name: "项目二" },
  ]);
  await knex("o_assets").insert([
    { id: 1, name: "角色A", type: "role", projectId: 1 },
    { id: 2, name: "角色B", type: "role", projectId: 2 },
  ]);
}

function fakeMediaStore(
  overrides: Partial<AssetReferenceMediaStore> = {},
): AssetReferenceMediaStore & { removedPaths: string[] } {
  const removedPaths: string[] = [];
  const store: AssetReferenceMediaStore & { removedPaths: string[] } = {
    async write({ projectId, orderIndex }) {
      return {
        mediaPath: `/${projectId}/assetReferences/ref-${orderIndex}.png`,
        mediaMime: "image/png",
      };
    },
    async remove(mediaPath) {
      removedPaths.push(mediaPath);
    },
    removedPaths,
    ...overrides,
  };
  return store;
}

function referenceInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 1,
    assetsId: 1,
    description: "正面半身标准像，黑色道袍，束发",
    visualRole: "正面标准像",
    requiredTransfers: ["脸部特征", "服饰轮廓"],
    exclusions: ["背景元素"],
    ...overrides,
  };
}

async function createCount(knex: Knex, count: number): Promise<void> {
  const work = workOf(knex);
  for (let index = 0; index < count; index++) {
    const result = await createAssetReference(
      work,
      referenceInput({ description: `人工描述 ${index}` }),
      fakeMediaStore(),
    );
    assert.equal(result.ok, true);
  }
}

const EXPECTED_COLUMNS = [
  "analysisState",
  "assetsId",
  "createTime",
  "description",
  "descriptionSource",
  "exclusions",
  "id",
  "mediaMime",
  "mediaPath",
  "orderIndex",
  "projectId",
  "requiredTransfers",
  "updateTime",
  "visualRole",
];

test("fresh database creates the Asset Reference table with a provider-independent contract", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-ref-fresh-");
  try {
    await prepareSchema(knex);
    assert.equal(await knex.schema.hasTable("o_assetReference"), true);
    const columns = Object.keys(await knex("o_assetReference").columnInfo()).sort();
    assert.deepEqual(columns, EXPECTED_COLUMNS.slice().sort());
    // 持久化契约不得出现 Vendor 名称或供应商线格式
    for (const column of columns) {
      assert.match(column, /^(id|projectId|assetsId|mediaPath|mediaMime|orderIndex|description|descriptionSource|analysisState|visualRole|requiredTransfers|exclusions|createTime|updateTime)$/);
    }
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the schema enforces one reference per order slot as a concurrency backstop", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-ref-unique-");
  try {
    await prepareSchema(knex);
    const indexes: { name: string; unique: number; origin: string }[] = await knex.raw(
      "PRAGMA index_list('o_assetReference')",
    );
    const uniqueIndexes = indexes.filter((index) => index.unique === 1);
    assert.ok(uniqueIndexes.length > 0, "o_assetReference 应至少拥有一个唯一索引");
    let found = false;
    for (const index of uniqueIndexes) {
      const info: { name: string }[] = await knex.raw(`PRAGMA index_info('${index.name}')`);
      const columns = info.map((row) => row.name).sort();
      if (columns.length === 2 && columns[0] === "assetsId" && columns[1] === "orderIndex") {
        found = true;
      }
    }
    assert.ok(found, "应存在 (assetsId, orderIndex) 唯一索引");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an upgraded database gains the Asset Reference table through the readiness order", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-ref-upgrade-");
  const dataRoot = path.join(directory, "data");
  fs.cpSync(path.join(process.cwd(), "data", "vendor"), path.join(dataRoot, "vendor"), { recursive: true });
  fs.cpSync(path.join(process.cwd(), "data", "promptProfiles"), path.join(dataRoot, "promptProfiles"), {
    recursive: true,
  });
  try {
    await prepareSchema(knex);
    // 模拟旧版本数据库：缺少参考图表
    await knex.schema.dropTable("o_assetReference");

    // 应用 readiness 顺序：ensureSchema → applyUpgrades
    await initDB(knex);
    await fixDB(knex, dataRoot);

    assert.equal(await knex.schema.hasTable("o_assetReference"), true);
    const columns = Object.keys(await knex("o_assetReference").columnInfo()).sort();
    assert.deepEqual(columns, EXPECTED_COLUMNS.slice().sort());

    await seedProjectAndAssets(knex);
    const result = await createAssetReference(workOf(knex), referenceInput(), fakeMediaStore());
    assert.equal(result.ok, true);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("reloading the readiness lifecycle preserves persisted references", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-ref-reload-");
  const dataRoot = path.join(directory, "data");
  fs.cpSync(path.join(process.cwd(), "data", "vendor"), path.join(dataRoot, "vendor"), { recursive: true });
  fs.cpSync(path.join(process.cwd(), "data", "promptProfiles"), path.join(dataRoot, "promptProfiles"), {
    recursive: true,
  });
  try {
    await prepareSchema(knex);
    await seedProjectAndAssets(knex);
    await createCount(knex, 2);

    // 模拟重启：重放 readiness 顺序
    await initDB(knex);
    await fixDB(knex, dataRoot);

    const list = await listAssetReferences(workOf(knex), { projectId: 1, assetsId: 1 });
    assert.equal(list.ok, true);
    if (!list.ok) return;
    assert.equal(list.value.length, 2);
    assert.deepEqual(
      list.value.map((record) => record.description),
      ["人工描述 0", "人工描述 1"],
    );
    assert.deepEqual(
      list.value.map((record) => record.mediaPath),
      ["/1/assetReferences/ref-0.png", "/1/assetReferences/ref-1.png"],
    );
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("every operation validates Project and Asset ownership with stable error envelopes", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-ref-ownership-");
  try {
    await prepareSchema(knex);
    await seedProjectAndAssets(knex);
    const work = workOf(knex);

    const missingProject = await createAssetReference(work, referenceInput({ projectId: 999 }), fakeMediaStore());
    assert.equal(missingProject.ok, false);
    if (!missingProject.ok) assert.equal(missingProject.failure.kind, "projectNotFound");

    const missingAsset = await createAssetReference(work, referenceInput({ assetsId: 999 }), fakeMediaStore());
    assert.equal(missingAsset.ok, false);
    if (!missingAsset.ok) assert.equal(missingAsset.failure.kind, "assetNotFound");

    const mismatched = await createAssetReference(work, referenceInput({ projectId: 1, assetsId: 2 }), fakeMediaStore());
    assert.equal(mismatched.ok, false);
    if (!mismatched.ok) assert.equal(mismatched.failure.kind, "assetProjectMismatch");

    const created = await createAssetReference(work, referenceInput(), fakeMediaStore());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const referenceId = created.value.id;

    const updateMismatch = await updateAssetReference(work, {
      projectId: 1,
      assetsId: 2,
      id: referenceId,
      description: "越权更新",
    });
    assert.equal(updateMismatch.ok, false);
    if (!updateMismatch.ok) assert.equal(updateMismatch.failure.kind, "assetProjectMismatch");

    const deleteMissing = await deleteAssetReference(work, { projectId: 1, assetsId: 999, id: referenceId });
    assert.equal(deleteMissing.ok, false);
    if (!deleteMissing.ok) assert.equal(deleteMissing.failure.kind, "assetNotFound");

    const reorderMismatch = await reorderAssetReferences(work, {
      projectId: 1,
      assetsId: 2,
      orderedIds: [referenceId],
    });
    assert.equal(reorderMismatch.ok, false);
    if (!reorderMismatch.ok) assert.equal(reorderMismatch.failure.kind, "assetProjectMismatch");

    const foreignReference = await deleteAssetReference(work, { projectId: 2, assetsId: 2, id: referenceId });
    assert.equal(foreignReference.ok, false);
    if (!foreignReference.ok) assert.equal(foreignReference.failure.kind, "referenceNotFound");

    // 稳定错误信封：kind → 状态码与结构固定
    const envelope = assetReferenceErrorEnvelope({ kind: "referenceLimitExceeded", message: "" });
    assert.equal(envelope.status, 400);
    assert.equal(envelope.body.code, 400);
    assert.equal(envelope.body.error, "referenceLimitExceeded");
    assert.equal(envelope.body.data, null);
    assert.ok(envelope.body.message.length > 0);

    const notFoundEnvelope = assetReferenceErrorEnvelope({ kind: "assetNotFound", message: "" });
    assert.equal(notFoundEnvelope.status, 404);
    const forbiddenEnvelope = assetReferenceErrorEnvelope({ kind: "assetProjectMismatch", message: "" });
    assert.equal(forbiddenEnvelope.status, 403);
    const invalidMediaEnvelope = assetReferenceErrorEnvelope({ kind: "invalidMedia", message: "" });
    assert.equal(invalidMediaEnvelope.status, 400);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("ownership failures take priority over the reference limit", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-ref-priority-");
  try {
    await prepareSchema(knex);
    await seedProjectAndAssets(knex);
    await createCount(knex, ASSET_REFERENCE_LIMIT);
    const work = workOf(knex);

    const missingProject = await createAssetReference(work, referenceInput({ projectId: 999 }), fakeMediaStore());
    assert.equal(missingProject.ok, false);
    if (!missingProject.ok) assert.equal(missingProject.failure.kind, "projectNotFound");

    const mismatched = await createAssetReference(work, referenceInput({ assetsId: 2 }), fakeMediaStore());
    assert.equal(mismatched.ok, false);
    if (!mismatched.ok) assert.equal(mismatched.failure.kind, "assetProjectMismatch");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an Asset holds zero through six references and the seventh is rejected before persisting", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-ref-limit-");
  try {
    await prepareSchema(knex);
    await seedProjectAndAssets(knex);
    const work = workOf(knex);

    // 0 张是合法状态
    const empty = await listAssetReferences(work, { projectId: 1, assetsId: 1 });
    assert.equal(empty.ok, true);
    if (empty.ok) assert.deepEqual(empty.value, []);

    await createCount(knex, ASSET_REFERENCE_LIMIT);
    const filled = await listAssetReferences(work, { projectId: 1, assetsId: 1 });
    assert.equal(filled.ok, true);
    if (!filled.ok) return;
    assert.equal(filled.value.length, ASSET_REFERENCE_LIMIT);
    assert.deepEqual(
      filled.value.map((record) => record.orderIndex),
      [0, 1, 2, 3, 4, 5],
    );

    const seventh = await createAssetReference(work, referenceInput({ description: "第七张" }), fakeMediaStore());
    assert.equal(seventh.ok, false);
    if (!seventh.ok) assert.equal(seventh.failure.kind, "referenceLimitExceeded");

    const after = await listAssetReferences(work, { projectId: 1, assetsId: 1 });
    assert.equal(after.ok, true);
    if (after.ok) assert.equal(after.value.length, ASSET_REFERENCE_LIMIT);

    // 删除一张后可以再次补充
    const removed = await deleteAssetReference(work, { projectId: 1, assetsId: 1, id: filled.value[0].id });
    assert.equal(removed.ok, true);
    if (removed.ok) assert.equal(removed.value.mediaPath, "/1/assetReferences/ref-0.png");
    const replenished = await createAssetReference(
      work,
      referenceInput({ description: "补充参考图" }),
      fakeMediaStore(),
    );
    assert.equal(replenished.ok, true);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a concurrent insert that wins the order slot is rejected consistently and its media is compensated", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-ref-race-");
  try {
    await prepareSchema(knex);
    await seedProjectAndAssets(knex);
    const work = workOf(knex);

    // 模拟竞态：准入事务读到 count=0 后，另一个写入者抢先落库同 orderIndex 的行
    const store = fakeMediaStore({
      async write({ projectId, orderIndex }) {
        await knex("o_assetReference").insert({
          projectId,
          assetsId: 1,
          mediaPath: "/1/assetReferences/concurrent.png",
          mediaMime: "image/png",
          orderIndex,
          description: "并发写入者",
          descriptionSource: "manual",
          analysisState: "not_requested",
          visualRole: "",
          requiredTransfers: "[]",
          exclusions: "[]",
          createTime: Date.now(),
          updateTime: Date.now(),
        });
        return { mediaPath: "/1/assetReferences/ref-mine.png", mediaMime: "image/png" };
      },
    });

    const result = await createAssetReference(work, referenceInput({ description: "我的参考图" }), store);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, "referenceLimitExceeded");

    // 媒体补偿：本请求写入的媒体被回收
    assert.deepEqual(store.removedPaths, ["/1/assetReferences/ref-mine.png"]);

    // 数据库中没有留下本请求的行，只有并发写入者的行
    const rows = await knex("o_assetReference").select("mediaPath");
    assert.deepEqual(
      rows.map((row) => row.mediaPath),
      ["/1/assetReferences/concurrent.png"],
    );
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("manual description is mandatory for create and update in this version", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-ref-manual-");
  try {
    await prepareSchema(knex);
    await seedProjectAndAssets(knex);
    const work = workOf(knex);

    const emptyDescription = await createAssetReference(work, referenceInput({ description: "" }), fakeMediaStore());
    assert.equal(emptyDescription.ok, false);
    if (!emptyDescription.ok) assert.equal(emptyDescription.failure.kind, "descriptionRequired");

    const blankDescription = await createAssetReference(work, referenceInput({ description: "   " }), fakeMediaStore());
    assert.equal(blankDescription.ok, false);
    if (!blankDescription.ok) assert.equal(blankDescription.failure.kind, "descriptionRequired");

    const created = await createAssetReference(work, referenceInput(), fakeMediaStore());
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const cleared = await updateAssetReference(work, {
      projectId: 1,
      assetsId: 1,
      id: created.value.id,
      description: "  ",
    });
    assert.equal(cleared.ok, false);
    if (!cleared.ok) assert.equal(cleared.failure.kind, "descriptionRequired");

    const rewritten = await updateAssetReference(work, {
      projectId: 1,
      assetsId: 1,
      id: created.value.id,
      description: "侧面全身像，银灰长衫",
      visualRole: "侧面全身像",
      requiredTransfers: ["身形比例", " ", "发饰"],
      exclusions: [],
    });
    assert.equal(rewritten.ok, true);
    if (!rewritten.ok) return;
    assert.equal(rewritten.value.description, "侧面全身像，银灰长衫");
    assert.equal(rewritten.value.visualRole, "侧面全身像");
    assert.deepEqual(rewritten.value.requiredTransfers, ["身形比例", "发饰"]);
    assert.deepEqual(rewritten.value.exclusions, []);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("created references persist manual defaults and the reserved analysis seam stays inert", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-ref-analysis-");
  try {
    await prepareSchema(knex);
    await seedProjectAndAssets(knex);
    const work = workOf(knex);

    // 已批准的分析生命周期契约：not_requested | pending | completed | failed
    assert.deepEqual([...ASSET_REFERENCE_ANALYSIS_STATES], ["not_requested", "pending", "completed", "failed"]);

    const created = await createAssetReference(work, referenceInput(), fakeMediaStore());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.descriptionSource, ASSET_REFERENCE_MANUAL_SOURCE);
    assert.equal(created.value.analysisState, ASSET_REFERENCE_ANALYSIS_NOT_REQUESTED);
    assert.equal(created.value.mediaMime, "image/png");
    assert.deepEqual(created.value.requiredTransfers, ["脸部特征", "服饰轮廓"]);
    assert.deepEqual(created.value.exclusions, ["背景元素"]);

    // 预留的图像分析 seam 可调用但不实现自动分析
    const outcome = await analyzeAssetReference({
      mediaPath: created.value.mediaPath,
      mediaMime: created.value.mediaMime,
      asset: { projectId: 1, assetsId: 1, name: "角色A", type: "role", describe: null },
    });
    assert.deepEqual(outcome, { supported: false, reason: "analysis-not-implemented" });

    // seam 调用不产生持久化副作用
    const row = await knex("o_assetReference").where("id", created.value.id).first();
    assert.equal(row.descriptionSource, ASSET_REFERENCE_MANUAL_SOURCE);
    assert.equal(row.analysisState, ASSET_REFERENCE_ANALYSIS_NOT_REQUESTED);
    assert.equal(row.description, "正面半身标准像，黑色道袍，束发");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("list, reorder, and delete keep the persisted order consistent", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-ref-order-");
  try {
    await prepareSchema(knex);
    await seedProjectAndAssets(knex);
    const work = workOf(knex);
    await createCount(knex, 3);

    const initial = await listAssetReferences(work, { projectId: 1, assetsId: 1 });
    assert.equal(initial.ok, true);
    if (!initial.ok) return;
    const ids = initial.value.map((record) => record.id);
    assert.deepEqual(
      initial.value.map((record) => record.orderIndex),
      [0, 1, 2],
    );

    const reversed = [...ids].reverse();
    const reordered = await reorderAssetReferences(work, { projectId: 1, assetsId: 1, orderedIds: reversed });
    assert.equal(reordered.ok, true);
    if (reordered.ok) {
      assert.deepEqual(
        reordered.value.map((record) => record.id),
        reversed,
      );
      assert.deepEqual(
        reordered.value.map((record) => record.orderIndex),
        [0, 1, 2],
      );
    }

    const partial = await reorderAssetReferences(work, { projectId: 1, assetsId: 1, orderedIds: ids.slice(0, 2) });
    assert.equal(partial.ok, false);
    if (!partial.ok) assert.equal(partial.failure.kind, "orderMismatch");

    const removed = await deleteAssetReference(work, { projectId: 1, assetsId: 1, id: reversed[0] });
    assert.equal(removed.ok, true);

    const remaining = await listAssetReferences(work, { projectId: 1, assetsId: 1 });
    assert.equal(remaining.ok, true);
    if (!remaining.ok) return;
    assert.equal(remaining.value.length, 2);
    assert.deepEqual(
      remaining.value.map((record) => record.orderIndex),
      [0, 1],
    );
    assert.equal(remaining.value.some((record) => record.id === reversed[0]), false);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("asset deletion cleanup removes reference rows and returns their media paths", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-ref-cleanup-");
  try {
    await prepareSchema(knex);
    await seedProjectAndAssets(knex);
    const work = workOf(knex);
    await createCount(knex, 2);
    const other = await createAssetReference(work, referenceInput({ projectId: 2, assetsId: 2 }), fakeMediaStore());
    assert.equal(other.ok, true);

    const removedPaths = await removeAssetReferencesForAssets(work, [1]);
    assert.deepEqual(removedPaths, ["/1/assetReferences/ref-0.png", "/1/assetReferences/ref-1.png"]);

    const remainingForAssetOne = await knex("o_assetReference").where("assetsId", 1).select();
    assert.deepEqual(remainingForAssetOne, []);
    const remainingForAssetTwo = await knex("o_assetReference").where("assetsId", 2).select();
    assert.equal(remainingForAssetTwo.length, 1);

    const empty = await removeAssetReferencesForAssets(work, []);
    assert.deepEqual(empty, []);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("uploaded media is validated by magic bytes instead of trusting the declared MIME", async () => {
  const pngPrefix = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(detectImageMime(Buffer.concat([pngPrefix, Buffer.alloc(8)])), "image/png");

  const jpegPrefix = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(detectImageMime(Buffer.concat([jpegPrefix, Buffer.alloc(8)])), "image/jpeg");

  assert.equal(detectImageMime(Buffer.from("GIF89a", "ascii")), "image/gif");
  assert.equal(detectImageMime(Buffer.from("GIF87a", "ascii")), "image/gif");

  const webp = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4), Buffer.from("WEBP", "ascii")]);
  assert.equal(detectImageMime(webp), "image/webp");

  // 文本、空内容、截断的 PNG 前缀都不是受支持的图片
  assert.equal(detectImageMime(Buffer.from("data:image/png;base64,AAAA", "utf8")), null);
  assert.equal(detectImageMime(Buffer.alloc(0)), null);
  assert.equal(detectImageMime(Buffer.from([0x89, 0x50, 0x4e])), null);
});
