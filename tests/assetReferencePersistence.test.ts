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
  ASSET_REFERENCE_ANALYSIS_NONE,
  ASSET_REFERENCE_LIMIT,
  ASSET_REFERENCE_MANUAL_SOURCE,
  assetReferenceErrorEnvelope,
  createAssetReference,
  deleteAssetReference,
  listAssetReferences,
  removeAssetReferencesForAssets,
  reorderAssetReferences,
  updateAssetReference,
  type AssetReferenceMediaWriter,
} from "../src/assets/assetReferences";
import { analyzeAssetReferenceImage } from "../src/assets/referenceImageAnalysis";

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

const fakeMediaWriter: AssetReferenceMediaWriter = async ({ projectId, orderIndex }) => ({
  mediaPath: `/${projectId}/assetReferences/ref-${orderIndex}.png`,
  mediaMime: "image/png",
});

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
      fakeMediaWriter,
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
    const result = await createAssetReference(workOf(knex), referenceInput(), fakeMediaWriter);
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

    const missingProject = await createAssetReference(work, referenceInput({ projectId: 999 }), fakeMediaWriter);
    assert.equal(missingProject.ok, false);
    if (!missingProject.ok) assert.equal(missingProject.failure.kind, "projectNotFound");

    const missingAsset = await createAssetReference(work, referenceInput({ assetsId: 999 }), fakeMediaWriter);
    assert.equal(missingAsset.ok, false);
    if (!missingAsset.ok) assert.equal(missingAsset.failure.kind, "assetNotFound");

    const mismatched = await createAssetReference(
      work,
      referenceInput({ projectId: 1, assetsId: 2 }),
      fakeMediaWriter,
    );
    assert.equal(mismatched.ok, false);
    if (!mismatched.ok) assert.equal(mismatched.failure.kind, "assetProjectMismatch");

    const created = await createAssetReference(work, referenceInput(), fakeMediaWriter);
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

    const seventh = await createAssetReference(work, referenceInput({ description: "第七张" }), fakeMediaWriter);
    assert.equal(seventh.ok, false);
    if (!seventh.ok) assert.equal(seventh.failure.kind, "referenceLimitExceeded");

    const after = await listAssetReferences(work, { projectId: 1, assetsId: 1 });
    assert.equal(after.ok, true);
    if (after.ok) assert.equal(after.value.length, ASSET_REFERENCE_LIMIT);

    // 删除一张后可以再次补充
    const removed = await deleteAssetReference(work, { projectId: 1, assetsId: 1, id: filled.value[0].id });
    assert.equal(removed.ok, true);
    if (removed.ok) assert.equal(removed.value.mediaPath, "/1/assetReferences/ref-0.png");
    const replenished = await createAssetReference(work, referenceInput({ description: "补充参考图" }), fakeMediaWriter);
    assert.equal(replenished.ok, true);
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

    const emptyDescription = await createAssetReference(work, referenceInput({ description: "" }), fakeMediaWriter);
    assert.equal(emptyDescription.ok, false);
    if (!emptyDescription.ok) assert.equal(emptyDescription.failure.kind, "descriptionRequired");

    const blankDescription = await createAssetReference(work, referenceInput({ description: "   " }), fakeMediaWriter);
    assert.equal(blankDescription.ok, false);
    if (!blankDescription.ok) assert.equal(blankDescription.failure.kind, "descriptionRequired");

    const created = await createAssetReference(work, referenceInput(), fakeMediaWriter);
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

    const created = await createAssetReference(work, referenceInput(), fakeMediaWriter);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.descriptionSource, ASSET_REFERENCE_MANUAL_SOURCE);
    assert.equal(created.value.analysisState, ASSET_REFERENCE_ANALYSIS_NONE);
    assert.equal(created.value.mediaMime, "image/png");
    assert.deepEqual(created.value.requiredTransfers, ["脸部特征", "服饰轮廓"]);
    assert.deepEqual(created.value.exclusions, ["背景元素"]);

    // 预留的图像分析 seam 可调用但不实现自动分析
    const outcome = await analyzeAssetReferenceImage({
      mediaPath: created.value.mediaPath,
      mediaMime: created.value.mediaMime,
      asset: { projectId: 1, assetsId: 1, name: "角色A", type: "role", describe: null },
    });
    assert.deepEqual(outcome, { supported: false, reason: "analysis-not-implemented" });

    // seam 调用不产生持久化副作用
    const row = await knex("o_assetReference").where("id", created.value.id).first();
    assert.equal(row.descriptionSource, ASSET_REFERENCE_MANUAL_SOURCE);
    assert.equal(row.analysisState, ASSET_REFERENCE_ANALYSIS_NONE);
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
    const other = await createAssetReference(
      work,
      referenceInput({ projectId: 2, assetsId: 2 }),
      fakeMediaWriter,
    );
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
