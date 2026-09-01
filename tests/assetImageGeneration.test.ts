import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import initDB from "../src/lib/initDB";
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
  options: { generateImage?: (request: ImageGenerationRequest) => Promise<string> } = {},
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
    generateImage: async (request) => {
      vendorRequests.push(request);
      return options.generateImage ? options.generateImage(request) : GENERATED_BASE64;
    },
    recordGenerationTask: async (input) => {
      taskSnapshots.push({ describe: input.describe, content: input.content });
      return async (state, reason) => {
        taskStates.push({ state, reason });
      };
    },
    writeGeneratedImage: async (imagePath, data) => {
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
    assert.equal(harness.taskSnapshots[0].content, harness.taskSnapshots[1].content, "重试快照必须一致（可诊断）");
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
    assert.ok(placeholders.every((row) => row.state === "生成中"), "预置占位必须是生成中状态");

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
    assert.ok(String(image.errorReason).includes("上游超时"), "占位记录保留原始原因供诊断");
    assert.deepEqual(harness.taskStates, [{ state: -1, reason: "Agnes 图片生成失败（HTTP 500）：上游超时" }]);
    assert.equal(harness.taskSnapshots.length, 1, "失败也必须落快照（可重试诊断）");
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
    // cancelGenerate 的语义：把占位记录置为生成失败
    await knex("o_image").where("id", prepared.value[0].imageId).update({ state: "生成失败" });

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
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await knex("o_image").select();
    if (rows.length === count && rows.every((row) => row.state !== "生成中")) return;
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