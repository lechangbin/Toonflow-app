import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import initDB from "../src/lib/initDB";
import u from "../src/utils";
import { workOf } from "./databaseTestSupport";
import {
  ASSET_PROMPTING_SKILL_VERSION,
  createAssetPromptOrchestration,
  resolveAssetGenerationInputs,
  type AssetPromptOrchestrationDependencies,
} from "../src/assets/assetPromptOrchestration";
import { ASSET_REFERENCE_LIMIT } from "../src/assets/assetReferences";
import type { AssetBrief, AssetBriefBatch } from "../src/assets/assetBriefContract";
import type { ImageGenerationRequest } from "../src/vendor";
import express from "express";
import { once } from "node:events";
import {
  assetImageGenerationErrorEnvelope,
  generateAssetImage,
  prepareBatchAssetImages,
  type AssetImageGenerationDependencies,
} from "../src/assets/assetImageGeneration";
import { createGenerateAssetsRouter } from "../src/routes/assetsGenerate/generateAssets";
import { createBatchGenerateImageAssetsRouter } from "../src/routes/assetsGenerate/batchGenerateImageAssets";
import { createPollingImageAssetsRouter } from "../src/routes/assets/pollingImageAssets";
import { createGetAssetsRouter } from "../src/routes/assets/getAssetsApi";
import { createProductionPollingImageRouter } from "../src/routes/production/assets/pollingImage";
import { createBatchGenerateAssetsImageRouter } from "../src/routes/production/assets/batchGenerateAssetsImage";
import { createCancelGenerateRouter } from "../src/routes/assetsGenerate/cancelGenerate";
import { VendorImageGenerationError } from "../src/assets/imageGenerationLifecycle";

const SKILL_ROOT = path.resolve(process.cwd(), "data", "skills", "asset-prompting");
const SCRIPT_CONTENT = [
  "章台宫内，年轻的秦二世胡亥面对堆叠奏牍，身居帝位却在赵高逼视下反复迟疑。玄色礼制外袍保持严整，衣料细密，日常不经体力劳作。",
  "大泽乡戍卒营地，吴广与同伴在连日暴雨后检查误期名册。他长期行役，粗麻短褐被雨水和泥土磨旧，袖口有反复缝补，站姿向前、随时准备召集众人。",
].join("\n");

function createTemporaryDatabase(prefix: string): { directory: string; knex: Knex } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(directory, "db.sqlite") },
    useNullAsDefault: true,
  });
  return { directory, knex };
}

async function prepareSchema(knex: Knex): Promise<void> {
  await knex.raw("PRAGMA foreign_keys = OFF");
  await knex.schema.createTable("o_skillList", (table) => table.text("id").primary());
  await initDB(knex);
}

async function seedBasics(knex: Knex): Promise<void> {
  await knex("o_project").insert({ id: 1, name: "秦末项目", type: "短剧", intro: "秦末故事", artStyle: "guofeng_3d" });
  await knex("o_script").insert({ id: 11, name: "剧本", content: SCRIPT_CONTENT, projectId: 1, extractState: 2 });
  await knex("o_assets").insert([
    { id: 101, name: "胡亥", type: "role", describe: "秦二世，年轻皇帝，受赵高控制。", scriptId: 11, projectId: 1 },
    { id: 102, name: "吴广", type: "role", describe: "秦末戍卒领袖，参与大泽乡起义。", scriptId: 11, projectId: 1 },
  ]);
}

function referenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    projectId: 1,
    assetsId: 101,
    mediaPath: "/1/assetReferences/1.png",
    mediaMime: "image/png",
    orderIndex: 0,
    description: "正面半身标准像，玄色礼制外袍，束发",
    descriptionSource: "manual",
    analysisState: "not_requested",
    visualRole: "正面标准像",
    requiredTransfers: JSON.stringify(["脸部拓扑", "服饰轮廓"]),
    exclusions: JSON.stringify(["背景"]),
    createTime: 1,
    updateTime: 1,
    ...overrides,
  };
}

/** 受支持图片的字节（PNG magic + 可辨识负载），用于媒体顺序断言。 */
function pngBuffer(payload: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(payload, "utf8"),
  ]);
}

function goldenBatch(): AssetBriefBatch {
  return JSON.parse(
    fs.readFileSync(path.join(SKILL_ROOT, "fixtures", "historical-character-contrast.expected.json"), "utf8"),
  );
}

/** 生成 analyze 假实现：只为请求的资产返回 golden Brief，101 附带 count 张参考绑定。 */
function batchFor(assetsIds: readonly number[], referenceCount = 0): AssetBriefBatch {
  const batch = goldenBatch();
  const wanted = new Set(assetsIds);
  batch.assetBriefs = batch.assetBriefs.filter((brief: AssetBrief) => wanted.has(brief.assetId));
  const brief101 = batch.assetBriefs.find((brief: AssetBrief) => brief.assetId === 101);
  if (brief101) {
    brief101.referenceBindings = Array.from({ length: referenceCount }, (_, index) => ({
      referenceId: "ref-" + (index + 1),
      label: "参考图" + (index + 1),
      description: "第" + (index + 1) + "张人工描述",
      primaryRole: "identity",
      subjectSelector: null,
      mustPreserve: ["要素" + (index + 1)],
      mustIgnore: ["背景"],
      controlledDimensions: ["dimension" + (index + 1)],
      priority: (index % 6) + 1,
      evidenceSource: "manual",
    }));
  }
  return batch;
}

/** 提示词编排依赖：analyze 记录调用并返回 analyzeImpl 的结果。 */
function promptHarness(
  knex: Knex,
  analyzeImpl: () => unknown,
): { dependencies: AssetPromptOrchestrationDependencies; calls: unknown[] } {
  const calls: unknown[] = [];
  const dependencies: AssetPromptOrchestrationDependencies = {
    work: workOf(knex),
    analyze: async (input) => {
      calls.push(input);
      return analyzeImpl();
    },
    loadSkillFile: async (relativePath) => {
      try {
        return fs.readFileSync(path.join(SKILL_ROOT, ...relativePath.split("/")), "utf8");
      } catch {
        return null;
      }
    },
    getArtStylePrefix: async () => "国风3D渲染",
    getVisualManual: async () => "国风3D视觉手册：深色漆面、规整石基，避免现代元素。",
    now: () => 1700000000000,
  };
  return { dependencies, calls };
}

/** 生成提示词记录（图片生成的前置条件）。 */
async function generatePromptRecord(
  knex: Knex,
  assetsIds: readonly number[],
  referenceCount = 0,
): Promise<void> {
  const { dependencies } = promptHarness(knex, () => batchFor(assetsIds, referenceCount));
  const orchestration = createAssetPromptOrchestration(dependencies);
  const result = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [...assetsIds] });
  assert.equal(result.ok, true, "测试前置：提示词记录生成必须成功");
}

test("resolve 返回新鲜提示词、版本哈希与有序参考图", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-resolve-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assetReference").insert(referenceRow());
    await generatePromptRecord(knex, [101], 1);

    const { dependencies } = promptHarness(knex, () => {
      throw new Error("resolve 不应调用 Text Model");
    });
    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [101] });

    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.value.length, 1);
    const entry = resolved.value[0];
    const record = await knex("o_assetPromptRecord").where("assetsId", 101).first();
    assert.equal(entry.generationPrompt, record.generationPrompt, "最终提示词必须来自 o_assetPromptRecord");
    assert.equal(entry.assetRawType, "role");
    assert.equal(entry.name, "胡亥");
    assert.deepEqual(
      entry.promptRevision,
      {
        skillVersion: ASSET_PROMPTING_SKILL_VERSION,
        templateHash: record.templateHash,
        contextHash: record.contextHash,
        referenceHash: record.referenceHash,
      },
      "提示词版本必须携带完整 revision 哈希",
    );
    assert.equal(entry.references.length, 1);
    assert.equal(entry.references[0].id, 1);
    assert.deepEqual(entry.selectedReferenceIds, [1], "被编译器选中的参考图必须按 id 暴露");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("resolve 对无提示词记录的资产返回 promptNotGenerated", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-noprompt-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await generatePromptRecord(knex, [101]);

    const { dependencies } = promptHarness(knex, () => null);
    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [102] });

    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.failure.kind, "promptNotGenerated");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("参考图契约变化后 resolve 返回 stalePromptRecord 而不是静默使用", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-stale-ref-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assetReference").insert(referenceRow());
    await generatePromptRecord(knex, [101], 1);

    await knex("o_assetReference").where("id", 1).update({ description: "侧面全身像，玄色礼制外袍" });
    const { dependencies } = promptHarness(knex, () => null);
    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [101] });

    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.failure.kind, "stalePromptRecord");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("stale generation errors identify every affected asset without making image calls", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-all-stale-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await generatePromptRecord(knex, [101, 102]);
    await knex("o_script").where("id", 11).update({ content: SCRIPT_CONTENT + " changed" });
    const { dependencies } = promptHarness(knex, () => { throw new Error("No model calls"); });
    const result = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [102, 101] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "stalePromptRecord");
    assert.deepEqual(assetImageGenerationErrorEnvelope(result.failure).body.affectedAssets, [
      { id: 102, name: "吴广" }, { id: 101, name: "胡亥" },
    ]);
    assert.equal(await knex("o_image").count("* as n").first().then(row => Number(row?.n)), 0);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Script 变化后 resolve 返回 stalePromptRecord", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-stale-script-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await generatePromptRecord(knex, [101]);

    await knex("o_script").where("id", 11).update({ content: SCRIPT_CONTENT + "\n新增剧情。" });
    const { dependencies } = promptHarness(knex, () => null);
    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [101] });

    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.failure.kind, "stalePromptRecord");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("参考图超过能力上限时 resolve 返回 referenceLimitExceeded", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-limit-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    // 先以 6 张参考图生成合法记录，再绕过创建接口直接落库第 7 张，模拟历史数据/外部写入
    await knex("o_assetReference").insert(
      Array.from({ length: ASSET_REFERENCE_LIMIT }, (_, index) =>
        referenceRow({ id: index + 1, orderIndex: index, mediaPath: "/1/assetReferences/" + (index + 1) + ".png" }),
      ),
    );
    await generatePromptRecord(knex, [101], ASSET_REFERENCE_LIMIT);
    await knex("o_assetReference").insert(
      referenceRow({
        id: ASSET_REFERENCE_LIMIT + 1,
        orderIndex: ASSET_REFERENCE_LIMIT,
        mediaPath: "/1/assetReferences/" + (ASSET_REFERENCE_LIMIT + 1) + ".png",
      }),
    );

    const { dependencies } = promptHarness(knex, () => null);
    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [101] });

    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.failure.kind, "referenceLimitExceeded");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("resolve 透传所有权失败（无权限资产）", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-own-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assets").where("id", 102).update({ projectId: 2 });
    const { dependencies } = promptHarness(knex, () => null);

    const mismatch = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [102] });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.failure.kind, "assetProjectMismatch");

    const noProject = await resolveAssetGenerationInputs(dependencies, { projectId: 999, assetsIds: [101] });
    assert.equal(noProject.ok, false);
    if (!noProject.ok) assert.equal(noProject.failure.kind, "projectNotFound");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// ─── 图片生成领域入口（Issue #35） ────────────────────────────────────────────

const MODEL = "agnes:agnes-image-2.1-flash";
const GENERATED_BASE64 = Buffer.from("generated-image-bytes").toString("base64");

interface ImageHarness {
  deps: AssetImageGenerationDependencies;
  vendorRequests: ImageGenerationRequest[];
  taskSnapshots: { describe: string; content: string }[];
  taskStates: { state: 1 | -1; reason?: string }[];
  storage: Map<string, string>;
  media: Map<string, Buffer>;
}

/** 图片生成依赖：fake Vendor（无真实网络）、内存媒体与存储、快照捕获。 */
function imageHarness(
  knex: Knex,
  options: {
    generateImage?: (
      request: ImageGenerationRequest,
      onStage?: (stage: "generating" | "downloading" | "downloaded") => void | Promise<void>,
    ) => Promise<string>;
    writeGeneratedImage?: (imagePath: string, data: string) => Promise<void>;
    updateTask?: (state: 1 | -1, reason?: string, updatedContent?: string) => Promise<void>;
  } = {},
): ImageHarness {
  const { dependencies } = promptHarness(knex, () => {
    throw new Error("图片生成不得调用 Text Model");
  });
  const vendorRequests: ImageGenerationRequest[] = [];
  const taskSnapshots: { describe: string; content: string }[] = [];
  const taskStates: { state: 1 | -1; reason?: string }[] = [];
  const storage = new Map<string, string>();
  const media = new Map<string, Buffer>();
  const deps: AssetImageGenerationDependencies = {
    work: workOf(knex),
    resolveGenerationInputs: (input) => resolveAssetGenerationInputs(dependencies, input),
    readReferenceMedia: async (mediaPath) => {
      const buffer = media.get(mediaPath);
      if (!buffer) throw new Error(`ENOENT: ${mediaPath}`);
      return buffer;
    },
    generateImage: async (request, onStage) => {
      vendorRequests.push(request);
      return options.generateImage ? options.generateImage(request, onStage) : GENERATED_BASE64;
    },
    recordGenerationTask: async (input) => {
      taskSnapshots.push({ describe: input.describe, content: input.content });
      return async (state, reason, updatedContent) => {
        if (options.updateTask) await options.updateTask(state, reason, updatedContent);
        if (updatedContent !== undefined) taskSnapshots[taskSnapshots.length - 1].content = updatedContent;
        taskStates.push({ state, reason });
      };
    },
    writeGeneratedImage: async (imagePath, data) => {
      if (options.writeGeneratedImage) return options.writeGeneratedImage(imagePath, data);
      storage.set(imagePath, data);
    },
    getImageUrl: async (imagePath) => "/oss" + imagePath + "?size=20",
  };
  return { deps, vendorRequests, taskSnapshots, taskStates, storage, media };
}

/** 落库 count 张参考图（101），媒体写入 fake 存储；orderIndexes 可乱序。 */
async function seedReferences(harness: ImageHarness, knex: Knex, count: number, orderIndexes?: number[]): Promise<void> {
  const indexes = orderIndexes ?? Array.from({ length: count }, (_, index) => index);
  for (let index = 0; index < count; index += 1) {
    const id = index + 1;
    const mediaPath = "/1/assetReferences/" + id + ".png";
    await knex("o_assetReference").insert(
      referenceRow({ id, orderIndex: indexes[index], mediaPath, description: "第" + id + "张人工描述" }),
    );
    harness.media.set(mediaPath, pngBuffer("REF-" + id));
  }
}

test("零参考图资产生成纯文本请求并完成完整生命周期", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-text-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await generatePromptRecord(knex, [102]);
    const harness = imageHarness(knex);

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 102,
      model: MODEL,
      resolution: "1K",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(harness.vendorRequests.length, 1);
    const input = harness.vendorRequests[0].input;
    assert.equal(input.referenceList, undefined, "0 张参考图必须完全省略 reference media");
    assert.equal(input.size, "1K");
    assert.equal(input.aspectRatio, "16:9");
    assert.deepEqual(harness.vendorRequests[0].target, { vendorId: "agnes", modelId: "agnes-image-2.1-flash" });
    const record = await knex("o_assetPromptRecord").where("assetsId", 102).first();
    assert.equal(input.prompt, record.generationPrompt, "提交的提示词必须来自持久化提示词记录");

    const image = await knex("o_image").first();
    assert.equal(image.state, "已完成");
    assert.equal(image.assetsId, 102);
    assert.equal(image.type, "role");
    assert.equal(image.model, "agnes-image-2.1-flash");
    assert.equal(image.resolution, "1K");
    const asset = await knex("o_assets").where("id", 102).first();
    assert.equal(asset.imageId, image.id);
    assert.equal(harness.storage.get(image.filePath), GENERATED_BASE64);
    assert.deepEqual(harness.taskStates, [{ state: 1, reason: undefined }]);
    assert.equal(harness.taskSnapshots.length, 1);
    const snapshot = JSON.parse(harness.taskSnapshots[0].content);
    assert.deepEqual(snapshot.references, [], "0 张参考图的快照引用为空数组");
    assert.equal(snapshot.promptRevision.referenceHash.length, 64, "快照必须携带提示词版本哈希");
    assert.ok(harness.taskSnapshots[0].describe.includes("吴广"));
    assert.equal(result.value.assetsId, 102);
    assert.equal(result.value.imageUrl, "/oss" + image.filePath + "?size=20");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("单张参考图按顺序经 configured Vendor 接口传递且快照脱敏", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-single-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex);
    await seedReferences(harness, knex, 1);
    await generatePromptRecord(knex, [101], 1);

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 101,
      model: MODEL,
      resolution: "2K",
    });

    assert.equal(result.ok, true);
    const input = harness.vendorRequests[0].input;
    assert.deepEqual(input.referenceList, [
      { type: "image", base64: pngBuffer("REF-1").toString("base64") },
    ]);
    const snapshotRaw = harness.taskSnapshots[0].content;
    const snapshot = JSON.parse(snapshotRaw);
    assert.deepEqual(snapshot.references, [{ id: 1, orderIndex: 0, mediaMime: "image/png" }]);
    assert.ok(snapshot.promptRevision.referenceHash.length === 64);
    assert.ok(!snapshotRaw.includes(pngBuffer("REF-1").toString("base64")), "快照不得包含完整 base64 媒体");
    assert.ok(!snapshotRaw.includes("REF-1"), "快照不得包含媒体内容负载");
    assert.ok(!snapshotRaw.includes("/1/assetReferences/1.png"), "快照不得包含媒体存储路径");
    assert.ok(!snapshotRaw.includes("apiKey"), "快照不得包含凭证字段");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("六张参考图保持 orderIndex 顺序与人工意图", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-six-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex);
    // id 1..6 的 orderIndex 故意与 id 顺序交错：0..5 位依次是 id 2,1,4,3,6,5
    await seedReferences(harness, knex, 6, [1, 0, 3, 2, 5, 4]);
    await generatePromptRecord(knex, [101], 6);

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 101,
      model: MODEL,
      resolution: "1K",
    });

    assert.equal(result.ok, true);
    const input = harness.vendorRequests[0].input;
    assert.equal(input.referenceList?.length, 6);
    const expectedOrder = [2, 1, 4, 3, 6, 5];
    assert.deepEqual(
      input.referenceList?.map((item) => item.base64),
      expectedOrder.map((id) => pngBuffer("REF-" + id).toString("base64")),
      "参考媒体必须按 orderIndex 顺序传递",
    );
    const snapshot = JSON.parse(harness.taskSnapshots[0].content);
    assert.deepEqual(
      snapshot.references.map((item: { id: number }) => item.id),
      expectedOrder,
      "快照引用顺序与提交顺序一致",
    );
    const record = await knex("o_assetPromptRecord").where("assetsId", 101).first();
    assert.equal(input.prompt, record.generationPrompt, "提示词含人工参考契约原文，逐字不变");
    assert.ok(input.prompt.includes("第1张人工描述"), "人工描述必须保留在提交的提示词中");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("重试复用可诊断的稳定输入", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-retry-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex);
    await seedReferences(harness, knex, 1);
    await generatePromptRecord(knex, [101], 1);

    const first = await generateAssetImage(harness.deps, { projectId: 1, assetsId: 101, model: MODEL, resolution: "1K" });
    const second = await generateAssetImage(harness.deps, { projectId: 1, assetsId: 101, model: MODEL, resolution: "1K" });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(harness.vendorRequests.length, 2);
    assert.deepEqual(harness.vendorRequests[0].input, harness.vendorRequests[1].input, "重试必须提交完全相同的稳定输入");
    const firstSnapshot = JSON.parse(harness.taskSnapshots[0].content);
    const secondSnapshot = JSON.parse(harness.taskSnapshots[1].content);
    assert.equal(firstSnapshot.attempt, 1);
    assert.equal(secondSnapshot.attempt, 2);
    assert.equal(firstSnapshot.retryEvidence, null);
    assert.equal(secondSnapshot.retryEvidence, null, "上一次成功时不应伪造失败重试证据");
    const { attempt: firstAttempt, retryEvidence: firstRetryEvidence, ...firstStableInput } = firstSnapshot;
    const { attempt: secondAttempt, retryEvidence: secondRetryEvidence, ...secondStableInput } = secondSnapshot;
    assert.deepEqual(firstStableInput, secondStableInput, "重试的稳定生成输入快照必须一致");
    const images = await knex("o_image").select();
    assert.equal(images.length, 2, "重试生成新的 o_image 记录");
    assert.ok(images.every((image) => image.state === "已完成"));
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("批量预置占位后生成复用占位记录", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-batchunit-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex);
    await seedReferences(harness, knex, 1);
    await generatePromptRecord(knex, [101, 102], 1);

    const prepared = await prepareBatchAssetImages(harness.deps, {
      projectId: 1,
      assetsIds: [101, 102],
      model: MODEL,
      resolution: "1K",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal(prepared.value.length, 2);
    const placeholders = await knex("o_image").select();
    assert.equal(placeholders.length, 2);
    assert.ok(placeholders.every((row) => row.state === "等待中"), "预置占位必须先持久化为等待中（未获得本地并发槽）");

    const target = prepared.value.find((entry) => entry.assetsId === 101)!;
    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 101,
      model: MODEL,
      resolution: "1K",
      imageId: target.imageId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.imageId, target.imageId, "必须复用预置占位而不是新建记录");
    assert.equal((await knex("o_image").select()).length, 2);
    const completed = await knex("o_image").where("id", target.imageId).first();
    assert.equal(completed.state, "已完成");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("第 7 张参考图在外部调用前稳定拒绝", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-7th-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex);
    await seedReferences(harness, knex, ASSET_REFERENCE_LIMIT);
    await generatePromptRecord(knex, [101], ASSET_REFERENCE_LIMIT);
    // 绕过创建接口直接落库第 7 张，模拟历史数据/外部写入
    await knex("o_assetReference").insert(
      referenceRow({
        id: ASSET_REFERENCE_LIMIT + 1,
        orderIndex: ASSET_REFERENCE_LIMIT,
        mediaPath: "/1/assetReferences/7.png",
      }),
    );

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 101,
      model: MODEL,
      resolution: "1K",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "referenceLimitExceeded");
    assert.equal(harness.vendorRequests.length, 0, "必须在外部提交前失败");
    assert.equal(harness.taskSnapshots.length, 0);
    const envelope = assetImageGenerationErrorEnvelope(result.failure);
    assert.equal(envelope.status, 400);
    assert.equal(envelope.body.error, "referenceLimitExceeded");
    assert.ok(envelope.body.message.includes("6"));
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("参考图媒体文件缺失时在外部调用前失败", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-missing-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex);
    await seedReferences(harness, knex, 1);
    await generatePromptRecord(knex, [101], 1);
    harness.media.clear();

    const result = await generateAssetImage(harness.deps, { projectId: 1, assetsId: 101, model: MODEL, resolution: "1K" });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "referenceMediaUnreadable");
    assert.equal(harness.vendorRequests.length, 0, "必须在外部提交前失败");
    assert.equal((await knex("o_image").select()).length, 0, "单个路径在解析失败时不创建占位记录");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("参考图媒体内容非法或与持久化类型不一致时在外部调用前失败", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-invalid-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex);
    await seedReferences(harness, knex, 2);
    await generatePromptRecord(knex, [101], 2);
    // 第一张媒体被替换为非图片字节
    harness.media.set("/1/assetReferences/1.png", Buffer.from("this-is-not-an-image"));
    // 第二张是合法 PNG，但持久化 MIME 与内容不一致
    await knex("o_assetReference").where("id", 2).update({ mediaMime: "image/jpeg" });

    const result = await generateAssetImage(harness.deps, { projectId: 1, assetsId: 101, model: MODEL, resolution: "1K" });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "referenceMediaInvalid");
    assert.equal(harness.vendorRequests.length, 0);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("无权限资产在外部调用前失败", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-auth-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assets").where("id", 102).update({ projectId: 2 });
    await generatePromptRecord(knex, [101]);
    const harness = imageHarness(knex);

    const result = await generateAssetImage(harness.deps, { projectId: 1, assetsId: 102, model: MODEL, resolution: "1K" });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "assetProjectMismatch");
    assert.equal(harness.vendorRequests.length, 0);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("供应商失败时任务快照与占位记录保留诊断信息", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-vendor-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex, {
      generateImage: async () => {
        throw new Error("Agnes 图片生成失败（HTTP 500）：上游超时");
      },
    });
    await seedReferences(harness, knex, 1);
    await generatePromptRecord(knex, [101], 1);

    const result = await generateAssetImage(harness.deps, { projectId: 1, assetsId: 101, model: MODEL, resolution: "1K" });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "imageGenerationFailed");
    const envelope = assetImageGenerationErrorEnvelope(result.failure);
    assert.equal(envelope.status, 502);
    assert.ok(!JSON.stringify(envelope).includes("上游超时"), "稳定信封不得泄露供应商原始异常");
    const image = await knex("o_image").first();
    assert.equal(image.state, "生成失败");
    assert.match(String(image.errorReason), /^imageGenerationFailed:[a-f0-9]{64}$/u, "占位记录只保留脱敏失败指纹");
    assert.match(harness.taskStates[0].reason ?? "", /^imageGenerationFailed:[a-f0-9]{64}$/u);
    assert.equal(harness.taskSnapshots.length, 1, "失败也必须落快照（可重试诊断）");
    const snapshot = JSON.parse(harness.taskSnapshots[0].content);
    assert.equal(snapshot.failureEvidence.kind, "imageGenerationFailed");
    assert.match(snapshot.failureEvidence.failureReasonHash, /^[a-f0-9]{64}$/u);
    assert.ok(!harness.taskSnapshots[0].content.includes("上游超时"), "失败快照不得持久化原始异常");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("图片落盘失败时 Generation Task 与快照同步失败且只保留脱敏证据", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-persist-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex, {
      writeGeneratedImage: async () => {
        throw new Error("磁盘路径含私密用户目录");
      },
    });
    await generatePromptRecord(knex, [102]);

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 102,
      model: MODEL,
      resolution: "1K",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "imagePersistenceFailed");
    assert.equal(harness.taskStates.length, 1);
    assert.equal(harness.taskStates[0].state, -1);
    assert.match(harness.taskStates[0].reason ?? "", /^imagePersistenceFailed:[a-f0-9]{64}$/u);
    const snapshot = JSON.parse(harness.taskSnapshots[0].content);
    assert.equal(snapshot.failureEvidence.kind, "imagePersistenceFailed");
    assert.match(snapshot.failureEvidence.failureReasonHash, /^[a-f0-9]{64}$/u);
    assert.ok(!harness.taskSnapshots[0].content.includes("私密用户目录"));
    const image = await knex("o_image").first();
    assert.equal(image.state, "生成失败");
    assert.match(String(image.errorReason), /^imagePersistenceFailed:[a-f0-9]{64}$/u);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Generation Task 成功回写失败时补偿为图片与任务失败", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-task-finalize-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex, {
      updateTask: async (state) => {
        if (state === 1) throw new Error("任务表连接含私密地址");
      },
    });
    await generatePromptRecord(knex, [102]);

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 102,
      model: MODEL,
      resolution: "1K",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "imagePersistenceFailed");
    assert.equal(harness.taskStates.length, 1);
    assert.equal(harness.taskStates[0].state, -1);
    assert.match(harness.taskStates[0].reason ?? "", /^imagePersistenceFailed:[a-f0-9]{64}$/u);
    assert.ok(!harness.taskSnapshots[0].content.includes("私密地址"));
    const image = await knex("o_image").first();
    assert.equal(image.state, "生成失败");
    assert.match(String(image.errorReason), /^imagePersistenceFailed:[a-f0-9]{64}$/u);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("预置占位被取消后跳过外部调用", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-cancel-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex);
    await seedReferences(harness, knex, 1);
    await generatePromptRecord(knex, [101], 1);

    const prepared = await prepareBatchAssetImages(harness.deps, {
      projectId: 1,
      assetsIds: [101],
      model: MODEL,
      resolution: "1K",
    });
    if (!prepared.ok) throw new Error("预置失败");
    // cancelGenerate 的新语义（Issue #39）：只在非终态上置为“已取消”
    await knex("o_image").where("id", prepared.value[0].imageId).update({ state: "已取消" });

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 101,
      model: MODEL,
      resolution: "1K",
      imageId: prepared.value[0].imageId,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "cancelled");
    assert.equal(harness.vendorRequests.length, 0);
    assert.equal(harness.taskSnapshots.length, 0);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// ─── 图片生成生命周期（Issue #39） ────────────────────────────────────────────

test("批量占位只在供应商真正获得执行槽时从等待中迁移到生成中", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-waitgen-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await generatePromptRecord(knex, [102]);
    const observedStates: string[] = [];
    const harness = imageHarness(knex, {
      generateImage: async (_request, onStage) => {
        observedStates.push((await knex("o_image").first()).state);
        await onStage?.("generating");
        observedStates.push((await knex("o_image").first()).state);
        return GENERATED_BASE64;
      },
    });

    const prepared = await prepareBatchAssetImages(harness.deps, {
      projectId: 1,
      assetsIds: [102],
      model: MODEL,
      resolution: "1K",
    });
    if (!prepared.ok) throw new Error("预置失败");
    assert.equal((await knex("o_image").first()).state, "等待中", "预置后必须是等待中");

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 102,
      model: MODEL,
      resolution: "1K",
      imageId: prepared.value[0].imageId,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(observedStates, ["等待中", "生成中"], "排队时保持等待中，获得执行槽后才进入生成中");
    assert.equal((await knex("o_image").first()).state, "已完成");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("URL 响应只在供应商媒体下载期间进入下载中", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-urlstage-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await generatePromptRecord(knex, [102]);
    const observedStates: string[] = [];
    const harness = imageHarness(knex, {
      generateImage: async (_request, onStage) => {
        await onStage?.("downloading");
        observedStates.push((await knex("o_image").first()).state);
        await onStage?.("downloaded");
        observedStates.push((await knex("o_image").first()).state);
        return GENERATED_BASE64;
      },
    });

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 102,
      model: MODEL,
      resolution: "1K",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(observedStates, ["下载中", "生成中"], "下载完毕后必须退出下载中，OSS 写入不得被误标");
    assert.equal((await knex("o_image").first()).state, "已完成");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Base64 响应跳过下载中直接完成", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-b64stage-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await generatePromptRecord(knex, [102]);
    const statesDuringVendor: string[] = [];
    const harness = imageHarness(knex, {
      // Base64 直接返回：适配器不触发 onStage，领域也不得自行伪造下载阶段
      generateImage: async (_request, onStage) => {
        await onStage?.("generating");
        statesDuringVendor.push((await knex("o_image").first()).state);
        return GENERATED_BASE64;
      },
    });

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 102,
      model: MODEL,
      resolution: "1K",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(statesDuringVendor, ["生成中"], "Base64 结果必须全程停留在生成中");
    assert.equal((await knex("o_image").first()).state, "已完成");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("资产列表刷新为父资产保留稳定失败指纹", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-parent-asset-failure-refresh-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_image").insert({
      id: 41,
      type: "role",
      state: "生成失败",
      assetsId: 101,
      errorReason: "imageGenerationTimeout:" + "c".repeat(64),
      filePath: null,
    });
    await knex("o_assets").where("id", 101).update({ imageId: 41 });

    await withTestServer(createGetAssetsRouter(() => workOf(knex)), async (url) => {
      const response = await fetch(url + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: 1, type: "role", page: 1, limit: 10 }),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        code: number;
        data: { data: Array<{ id: number; state: string; errorReason: string | null }> };
      };
      const parent = body.data.data.find((item) => item.id === 101);
      assert.equal(parent?.state, "生成失败");
      assert.equal(parent?.errorReason, "imageGenerationTimeout:" + "c".repeat(64));
    });
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("供应商下载失败分类为 imageDownloadFailed 并保留脱敏诊断", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-dlfail-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await generatePromptRecord(knex, [102]);
    const harness = imageHarness(knex, {
      generateImage: async (_request, onStage) => {
        await onStage?.("downloading");
        throw new VendorImageGenerationError({
          kind: "downloadFailed",
          stage: "download",
          attempt: 1,
          elapsedMs: 1234,
          transportCode: "ECONNRESET",
        });
      },
    });

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 102,
      model: MODEL,
      resolution: "1K",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "imageDownloadFailed");
    assert.equal(assetImageGenerationErrorEnvelope(result.failure).status, 502);
    const image = await knex("o_image").first();
    assert.equal(image.state, "生成失败");
    assert.match(String(image.errorReason), /^imageDownloadFailed:[a-f0-9]{64}$/u);
    const snapshot = JSON.parse(harness.taskSnapshots[0].content);
    assert.equal(snapshot.failureEvidence.kind, "imageDownloadFailed");
    assert.equal(snapshot.failureEvidence.diagnostics.kind, "downloadFailed");
    assert.equal(snapshot.failureEvidence.diagnostics.stage, "download");
    assert.ok(
      !harness.taskSnapshots[0].content.includes("SECRET"),
      "诊断不得包含签名 URL 的凭证",
    );
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("供应商超时分类为 imageGenerationTimeout 且不自动重放", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-timeout-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await generatePromptRecord(knex, [102]);
    const harness = imageHarness(knex, {
      generateImage: async () => {
        throw new Error("Agnes 图片生成失败：timeout of 360000ms exceeded");
      },
    });

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 102,
      model: MODEL,
      resolution: "1K",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "imageGenerationTimeout");
    const envelope = assetImageGenerationErrorEnvelope(result.failure);
    assert.equal(envelope.status, 504);
    assert.equal(harness.vendorRequests.length, 1, "结果不确定的超时绝不自动重放 POST");
    const image = await knex("o_image").first();
    assert.equal(image.state, "生成失败");
    assert.match(String(image.errorReason), /^imageGenerationTimeout:[a-f0-9]{64}$/u);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("生成中取消后供应商迟到成功不覆盖已取消", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-cancelgen-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await generatePromptRecord(knex, [102]);
    const harness = imageHarness(knex, {
      generateImage: async () => {
        // 供应商调用期间用户取消（cancelGenerate 语义：非终态 → 已取消）
        await knex("o_image").update({ state: "已取消" });
        return GENERATED_BASE64;
      },
    });

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 102,
      model: MODEL,
      resolution: "1K",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "cancelled");
    assert.equal((await knex("o_image").first()).state, "已取消", "迟到成功不得覆盖已取消");
    assert.equal(harness.storage.size, 0, "已取消任务不得落盘媒体");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("下载中取消后供应商迟到成功不覆盖已取消", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-canceldl-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await generatePromptRecord(knex, [102]);
    const harness = imageHarness(knex, {
      generateImage: async (_request, onStage) => {
        await onStage?.("downloading");
        await knex("o_image").update({ state: "已取消" });
        return GENERATED_BASE64;
      },
    });

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 102,
      model: MODEL,
      resolution: "1K",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "cancelled");
    assert.equal((await knex("o_image").first()).state, "已取消");
    assert.equal(harness.storage.size, 0);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("未生成提示词的资产在图片生成时稳定失败", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-norecord-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await generatePromptRecord(knex, [101]);
    const harness = imageHarness(knex);

    const result = await generateAssetImage(harness.deps, { projectId: 1, assetsId: 102, model: MODEL, resolution: "1K" });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "promptNotGenerated");
    assert.equal(harness.vendorRequests.length, 0);
    const envelope = assetImageGenerationErrorEnvelope(result.failure);
    assert.equal(envelope.status, 409);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("批量路径下提示词过期会回写占位记录", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-batchstale-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex);
    await seedReferences(harness, knex, 1);
    await generatePromptRecord(knex, [101], 1);

    const prepared = await prepareBatchAssetImages(harness.deps, {
      projectId: 1,
      assetsIds: [101],
      model: MODEL,
      resolution: "1K",
    });
    if (!prepared.ok) throw new Error("预置失败");
    // 参考图人工描述变化 → 提示词记录过期
    await knex("o_assetReference").where("id", 1).update({ description: "侧面全身像，玄色礼制外袍" });

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 101,
      model: MODEL,
      resolution: "1K",
      imageId: prepared.value[0].imageId,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "stalePromptRecord");
    assert.equal(harness.vendorRequests.length, 0, "过期提示词不得被静默使用");
    const image = await knex("o_image").first();
    assert.equal(image.state, "生成失败", "批量路径失败必须回写占位记录");
    assert.ok(String(image.errorReason).includes("stalePromptRecord"));
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("批量路径下参考图媒体缺失也回写占位记录", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-batchmedia-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex);
    await seedReferences(harness, knex, 1);
    await generatePromptRecord(knex, [101], 1);

    const prepared = await prepareBatchAssetImages(harness.deps, {
      projectId: 1,
      assetsIds: [101],
      model: MODEL,
      resolution: "1K",
    });
    if (!prepared.ok) throw new Error("预置失败");
    harness.media.clear();

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 101,
      model: MODEL,
      resolution: "1K",
      imageId: prepared.value[0].imageId,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "referenceMediaUnreadable");
    assert.equal(harness.vendorRequests.length, 0, "必须在外部提交前失败");
    assert.equal(harness.taskSnapshots.length, 0);
    const image = await knex("o_image").first();
    assert.equal(image.state, "生成失败", "媒体失败同样必须回写占位记录");
    assert.ok(String(image.errorReason).includes("referenceMediaUnreadable"));
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("批量预置拒绝无权限资产且不留占位", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-batchauth-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assets").where("id", 102).update({ projectId: 2 });
    const harness = imageHarness(knex);

    const mismatch = await prepareBatchAssetImages(harness.deps, {
      projectId: 1,
      assetsIds: [101, 102],
      model: MODEL,
      resolution: "1K",
    });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.failure.kind, "assetProjectMismatch");
    assert.equal((await knex("o_image").select()).length, 0, "所有权失败不得留下占位记录");

    const noProject = await prepareBatchAssetImages(harness.deps, {
      projectId: 999,
      assetsIds: [101],
      model: MODEL,
      resolution: "1K",
    });
    assert.equal(noProject.ok, false);
    if (!noProject.ok) assert.equal(noProject.failure.kind, "projectNotFound");

    const badModel = await prepareBatchAssetImages(harness.deps, {
      projectId: 1,
      assetsIds: [101],
      model: "not-a-vendor-model",
      resolution: "1K",
    });
    assert.equal(badModel.ok, false);
    if (!badModel.ok) assert.equal(badModel.failure.kind, "invalidRequest");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// ─── 路由迁移（旧临时单参考图路径） ──────────────────────────────────────────

async function withTestServer(router: express.Router, handler: (url: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    await handler("http://127.0.0.1:" + address.port);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function waitForImageStates(knex: Knex, count: number): Promise<void> {
  const terminal = new Set(["已完成", "生成失败", "已取消"]);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await knex("o_image").select();
    if (rows.length === count && rows.every((row) => terminal.has(row.state))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等待图片状态回写超时");
}

test("单个生成路由委托领域模块并忽略旧临时字段", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-route-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex);
    await seedReferences(harness, knex, 1);
    await generatePromptRecord(knex, [101], 1);

    await withTestServer(createGenerateAssetsRouter(() => harness.deps), async (url) => {
      const response = await fetch(url + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: 1,
          model: MODEL,
          resolution: "1K",
          id: 101,
          // 旧请求体字段：校验后必须被忽略，不再参与生成
          type: "role",
          name: "胡亥",
          prompt: "旧的手写提示词",
          base64: "aGVsbG8=",
        }),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { code: number; data: { path: string; assetsId: number } };
      assert.equal(body.code, 200);
      assert.equal(body.data.assetsId, 101);
      assert.ok(body.data.path.startsWith("/oss/1/role/"));
    });

    assert.equal(harness.vendorRequests.length, 1);
    const input = harness.vendorRequests[0].input;
    const record = await knex("o_assetPromptRecord").where("assetsId", 101).first();
    assert.equal(input.prompt, record.generationPrompt, "路由不得使用请求体里的旧提示词");
    assert.ok(!input.prompt.includes("旧的手写提示词"));
    assert.deepEqual(input.referenceList, [
      { type: "image", base64: pngBuffer("REF-1").toString("base64") },
    ], "路由不得使用请求体里的临时 base64 参考图");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("批量生成路由预置占位并后台逐项完成", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-batchroute-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const harness = imageHarness(knex);
    await seedReferences(harness, knex, 1);
    await generatePromptRecord(knex, [101, 102], 1);

    await withTestServer(createBatchGenerateImageAssetsRouter(() => harness.deps), async (url) => {
      const response = await fetch(url + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: 1,
          model: MODEL,
          resolution: "1K",
          concurrentCount: 2,
          items: [
            // 旧 items 字段（type/name/prompt/base64）兼容透传但不参与生成
            { id: 101, type: "role", name: "胡亥", prompt: "旧提示词", base64: "aGVsbG8=" },
            { id: 102 },
          ],
        }),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { code: number; data: { total: number } };
      assert.equal(body.code, 200);
      assert.equal(body.data.total, 2);
    });

    await waitForImageStates(knex, 2);
    const images = await knex("o_image").select();
    assert.ok(images.every((image) => image.state === "已完成"), "后台逐项生成必须全部完成");
    assert.equal(harness.vendorRequests.length, 2);
    const byPromptAsset = new Map(
      harness.vendorRequests.map((request) => {
        const assetsId = request.input.prompt.includes("第1张人工描述") ? 101 : 102;
        return [assetsId, request.input];
      }),
    );
    assert.equal(byPromptAsset.get(101)?.referenceList?.length, 1, "101 提交持久化参考图");
    assert.equal(byPromptAsset.get(102)?.referenceList, undefined, "102 是纯文本请求");
    assert.ok(images.every((image) => image.filePath));
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("批量队列并发槽外的任务保持等待中", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-queue-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await generatePromptRecord(knex, [101, 102]);
    let releaseFirst!: () => void;
    const firstInFlight = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let vendorCalls = 0;
    const harness = imageHarness(knex, {
      generateImage: async (_request, onStage) => {
        await onStage?.("generating");
        vendorCalls += 1;
        if (vendorCalls === 1) await firstInFlight;
        return GENERATED_BASE64;
      },
    });

    await withTestServer(createBatchGenerateImageAssetsRouter(() => harness.deps), async (url) => {
      const response = await fetch(url + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: 1,
          model: MODEL,
          resolution: "1K",
          concurrentCount: 1,
          items: [{ id: 101 }, { id: 102 }],
        }),
      });
      assert.equal(response.status, 200);

      // 等待第一个任务获得执行槽（进入生成中并被 gate 阻塞）
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (vendorCalls === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(vendorCalls, 1, "并发上限 1 时只有一个任务获得执行槽");
      const states = (await knex("o_image").select()).map((row) => row.state).sort();
      assert.deepEqual(states, ["生成中", "等待中"], "槽内任务生成中，槽外任务必须保持等待中");

      releaseFirst();
    });

    await waitForImageStates(knex, 2);
    const images = await knex("o_image").select();
    assert.ok(images.every((image) => image.state === "已完成"));
    assert.equal(harness.vendorRequests.length, 2);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Production Agent 生成入口复用等待→生成→终态生命周期", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-production-generation-entry-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_project").where("id", 1).update({ imageModel: MODEL, imageQuality: "1K" });
    await generatePromptRecord(knex, [101, 102]);
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    const harness = imageHarness(knex, {
      generateImage: async (_request, onStage) => {
        await onStage?.("generating");
        calls += 1;
        if (calls === 1) await gate;
        return GENERATED_BASE64;
      },
    });

    await withTestServer(createBatchGenerateAssetsImageRouter(() => harness.deps), async (url) => {
      const response = await fetch(url + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: [101, 102], projectId: 1, scriptId: 11, concurrentCount: 1 }),
      });
      assert.equal(response.status, 200);
      for (let attempt = 0; attempt < 200 && calls === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.deepEqual(
        (await knex("o_image").pluck("state")).sort(),
        ["生成中", "等待中"],
        "Production Agent 入口也必须让槽外任务保持等待中",
      );
      releaseFirst();
    });
    await waitForImageStates(knex, 2);
    assert.deepEqual((await knex("o_image").pluck("state")).sort(), ["已完成", "已完成"]);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("取消 HTTP 入口覆盖等待中、生成中、下载中且不改写终态", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-image-cancel-route-");
  try {
    await prepareSchema(knex);
    await knex("o_image").insert([
      { id: 1, state: "等待中" },
      { id: 2, state: "生成中" },
      { id: 3, state: "下载中" },
      { id: 4, state: "已完成" },
    ]);
    await withTestServer(createCancelGenerateRouter(() => workOf(knex)), async (url) => {
      for (const id of [1, 2, 3, 4]) {
        const response = await fetch(url + "/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        assert.equal(response.status, 200);
      }
    });
    assert.deepEqual(await knex("o_image").orderBy("id").pluck("state"), ["已取消", "已取消", "已取消", "已完成"]);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("轮询接口为每个请求的资产返回权威状态（含缺失）", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-image-polling-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assets").insert(
      [103, 104, 105, 106, 107].map((id) => ({
        id,
        name: "资产" + id,
        type: "role",
        describe: "轮询测试资产",
        scriptId: 11,
        projectId: 1,
      })),
    );
    // 直接落库每个生命周期的 o_image 记录，验证刷新/重新读取语义
    const seedImage = async (id: number, state: string, errorReason?: string, filePath?: string) => {
      await knex("o_image").insert({
        id,
        type: "role",
        state,
        assetsId: 100 + id,
        errorReason: errorReason ?? null,
        filePath: filePath ?? null,
      });
      await knex("o_assets").where("id", 100 + id).update({ imageId: id });
    };
    await seedImage(1, "等待中");
    await seedImage(2, "生成中");
    await seedImage(3, "下载中");
    await seedImage(4, "已完成", undefined, "/1/role/done.jpg");
    await seedImage(5, "生成失败", "imageGenerationTimeout:" + "a".repeat(64));
    await seedImage(6, "已取消");

    const original = u.oss.getSmallImageUrl.bind(u.oss);
    u.oss.getSmallImageUrl = async () => "/oss/fake.jpg?size=20";
    try {
      await withTestServer(createPollingImageAssetsRouter(() => workOf(knex)), async (url) => {
        const response = await fetch(url + "/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [101, 102, 103, 104, 105, 106, 107, 999] }),
        });
        assert.equal(response.status, 200);
        const body = (await response.json()) as {
          code: number;
          data: { id: number; state: string | null; filePath: string | null; errorKind: string | null }[];
        };
        assert.equal(body.code, 200);
        const byId = new Map(body.data.map((row) => [row.id, row]));
        assert.equal(byId.get(101)?.state, "等待中");
        assert.equal(byId.get(102)?.state, "生成中");
        assert.equal(byId.get(103)?.state, "下载中");
        assert.equal(byId.get(104)?.state, "已完成");
        assert.equal(byId.get(104)?.filePath, "/oss/fake.jpg?size=20");
        assert.equal(byId.get(105)?.state, "生成失败");
        assert.equal(byId.get(105)?.errorKind, "imageGenerationTimeout");
        assert.equal(byId.get(106)?.state, "已取消");
        assert.equal(byId.get(107)?.state, null, "imageId 为空的资产返回 null 而不是被省略");
        assert.equal(byId.get(999)?.state, null, "不存在的资产也必须返回一条结果，前端不得永久等待");
        assert.equal(body.data.length, 8, "每个请求 id 恰好一条结果");
      });
    } finally {
      u.oss.getSmallImageUrl = original;
    }
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Production 轮询接口与资产页轮询共用同一生命周期契约", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-production-polling-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assets").insert([
      { id: 201, name: "生产资产A", type: "role", describe: "d", scriptId: 11, projectId: 1, prompt: "提示词A" },
      { id: 202, name: "生产资产B", type: "role", describe: "d", scriptId: 11, projectId: 1 },
    ]);
    await knex("o_image").insert({ id: 11, type: "role", state: "下载中", assetsId: 201, errorReason: null, filePath: null });
    await knex("o_image").insert({
      id: 12,
      type: "role",
      state: "生成失败",
      assetsId: 202,
      errorReason: "imageDownloadFailed:" + "b".repeat(64),
      filePath: null,
    });
    await knex("o_assets").where("id", 201).update({ imageId: 11 });
    await knex("o_assets").where("id", 202).update({ imageId: 12 });

    const original = u.oss.getSmallImageUrl.bind(u.oss);
    u.oss.getSmallImageUrl = async () => "/oss/fake.jpg?size=20";
    try {
      await withTestServer(createProductionPollingImageRouter(() => workOf(knex)), async (url) => {
        const response = await fetch(url + "/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [201, 202, 999] }),
        });
        assert.equal(response.status, 200);
        const body = (await response.json()) as {
          code: number;
          data: { id: number; state: string | null; src: string | null; errorKind: string | null; prompt: string | null }[];
        };
        assert.equal(body.code, 200);
        const byId = new Map(body.data.map((row) => [row.id, row]));
        assert.equal(byId.get(201)?.state, "下载中");
        assert.equal(byId.get(201)?.prompt, "提示词A");
        assert.equal(byId.get(202)?.state, "生成失败");
        assert.equal(byId.get(202)?.errorKind, "imageDownloadFailed");
        assert.equal(byId.get(999)?.state, null, "缺失资产必须返回一条 null 记录，前端不得永久等待");
        assert.equal(body.data.length, 3);
      });
    } finally {
      u.oss.getSmallImageUrl = original;
    }
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("资产图片生成路由是薄适配器（静态迁移守卫）", () => {
  const readSource = (relative: string) => fs.readFileSync(path.join(process.cwd(), "src", relative), "utf8");
  for (const relative of [
    "routes/assetsGenerate/generateAssets.ts",
    "routes/assetsGenerate/batchGenerateImageAssets.ts",
  ]) {
    const source = readSource(relative);
    assert.ok(!source.includes("base64"), relative + " 不得读取请求中的临时 base64 参考图");
    assert.ok(source.includes('from "@/assets/assetImageGeneration"'), relative + " 未委托图片生成领域模块");
    assert.ok(!source.includes("getDefaultConfiguredVendor"), relative + " 不得绕过领域模块直接调用 Vendor");
    assert.ok(!source.includes("applyLegacyImageReferenceConversion"), relative + " 供应商翻译不得出现在路由");
  }
  const domain = readSource("assets/assetImageGeneration.ts");
  assert.ok(!domain.includes("extra_body"), "业务代码不得构造 Agnes 专属 wire 字段");
  assert.ok(!domain.includes('"imageBase64"'), "业务代码不得直接构造旧供应商 wire 字段");
});
