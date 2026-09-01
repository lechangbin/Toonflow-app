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
  assetPromptErrorEnvelope,
  createAssetPromptOrchestration,
  normalizeBatchPromptRequest,
  removeAssetPromptRecordRows,
  type AssetPromptOrchestrationDependencies,
} from "../src/assets/assetPromptOrchestration";
import type { AssetBrief, AssetBriefBatch } from "../src/assets/assetBriefContract";

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
    { id: 201, name: "章台宫奏牍殿", type: "scene", describe: "秦末宫廷朝堂空间。", scriptId: 11, projectId: 1 },
    { id: 301, name: "误期名册木牍", type: "tool", describe: "记录戍卒姓名与到期日期的官府木牍。", scriptId: 11, projectId: 1 },
    { id: 302, name: "浸湿的误期名册木牍", type: "tool", describe: "暴雨中被浸湿的误期名册。", scriptId: 11, projectId: 1, assetsId: 301 },
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

function goldenBatchWithReference(): AssetBriefBatch {
  const batch = JSON.parse(
    fs.readFileSync(path.join(SKILL_ROOT, "fixtures", "historical-character-contrast.expected.json"), "utf8"),
  );
  const brief101 = batch.assetBriefs.find((brief: AssetBrief) => brief.assetId === 101)!;
  brief101.referenceBindings = [
    {
      referenceId: "ref-1",
      label: "正面标准像",
      description: "正面半身标准像，玄色礼制外袍，束发",
      primaryRole: "identity",
      subjectSelector: null,
      mustPreserve: ["脸部拓扑", "服饰轮廓"],
      mustIgnore: ["背景"],
      controlledDimensions: ["faceTopology", "wardrobeStructure"],
      priority: 1,
      evidenceSource: "manual",
    },
  ];
  return batch;
}

function sceneBrief201(): AssetBrief {
  return {
    assetId: 201,
    assetType: "scene",
    isDerived: false,
    parentAssetId: null,
    name: "章台宫奏牍殿",
    narrativeFunction: "承担朝堂决策与权力压迫的秦末宫廷空间",
    eraRegion: "秦末咸阳宫廷",
    evidence: [{ source: "script", fact: "奏牍堆叠", locator: "scriptExcerpt[0]", confidence: "explicit" }],
    immutable: ["纵深中轴"],
    flexible: ["时段"],
    storyChanging: [],
    differenceAnchors: [
      { dimension: "spatialStructure", value: "纵深中轴从低位臣属行动平面通向高台御座", reason: "剧本明确" },
      { dimension: "maintenanceState", value: "细密木作维护严整", reason: "剧本明确" },
    ],
    forbiddenDefaults: ["通用豪华大殿", "空白影棚"],
    contrastAgainstSiblingAssets: [],
    referenceBindings: [],
    generationRequirements: {
      outputFormat: "国风3D场景主视图",
      composition: "单画面，人眼平视",
      background: "物理光照，前中后景清楚",
      requiredElements: ["高台御座"],
      prohibitedElements: ["人物", "人影", "人体轮廓", "文字"],
      aspectRatio: "16:9",
    },
    design: {
      spatialStructure: "纵深中轴从低位臣属行动平面通向高台御座，两侧狭长通道限制横向移动",
      actionPlane: "低位臣属行动平面",
      accessPattern: "殿门与屏障形成层层进入门槛",
      landmark: "高台、成排奏牍与压低视线的深色梁架",
      scale: "强调权位距离而非空泛宏大",
      architecture: "秦末宫廷建造方式",
      materialsCraft: "细密木作、平整深色漆面与规整石基",
      maintenanceState: "维护严整",
      useTraces: "奏牍堆叠和固定跪坐区域留下持续政务使用痕迹",
      timeWeatherState: "白昼殿内",
      negativeIdentity: ["不是通用豪华大殿"],
    },
  } as AssetBrief;
}

function propBrief(derived: boolean): AssetBrief {
  return {
    assetId: derived ? 302 : 301,
    assetType: "prop",
    isDerived: derived,
    parentAssetId: derived ? 301 : null,
    name: derived ? "浸湿的误期名册木牍" : "误期名册木牍",
    narrativeFunction: "记录戍卒姓名与到期日期，是戍卒误期证据",
    eraRegion: "秦末大泽乡",
    evidence: [{ source: "script", fact: "误期名册", locator: "scriptExcerpt[1]", confidence: "explicit" }],
    immutable: derived ? ["窄长木牍几何", "麻绳编联结构", "官府登记身份", "前臂相对尺度"] : ["窄长木牍几何"],
    flexible: ["麻绳打结位置"],
    storyChanging: derived ? ["暴雨浸湿", "轻微翘曲", "墨迹局部晕染"] : [],
    differenceAnchors: [
      { dimension: "materialsCraft", value: "普通木材粗磨加工，墨迹沿木纹渗入", reason: "剧本明确" },
      { dimension: "wearRepairHistory", value: "频繁翻检磨损并逐渐变圆", reason: "剧本明确" },
    ],
    forbiddenDefaults: ["华贵玉器", "无因雕花", "神秘发光"],
    contrastAgainstSiblingAssets: [],
    referenceBindings: [],
    generationRequirements: {
      outputFormat: "纯道具静物四宫格设定图",
      composition: derived ? "正面、侧面、背面、浸湿木纹与晕染墨迹细节" : "正面、侧面、背面、文字与绳结细节特写",
      background: "素灰背景，均匀柔光",
      requiredElements: ["麻绳编联"],
      prohibitedElements: ["人物", "手部", "人持有", "佩戴状态", "额外文字说明"],
      aspectRatio: "1:1",
    },
    design: {
      propClass: "evidence",
      owner: "官府",
      geometry: "多片窄长薄木牍以麻绳编联，合拢后约一名前臂长度",
      relativeScale: "约一名前臂长度",
      operation: "逐片翻检",
      materialsCraft: "普通木材粗磨加工，墨迹沿木纹渗入",
      wearRepairHistory: "频繁翻检磨损并逐渐变圆",
      distinctiveMarks: ["编联麻绳结"],
      continuity: "麻绳编联方式保持稳定",
      negativeIdentity: ["不是礼器"],
    },
  } as AssetBrief;
}

function multiTypeBatch(): AssetBriefBatch {
  const batch = goldenBatchWithReference();
  return {
    ...batch,
    assetBriefs: [sceneBrief201(), propBrief(false), propBrief(true)],
  };
}

function harness(
  knex: Knex,
  analyzeImpl: (input: { system: string; user: string }) => unknown,
  overrides: { visualManual?: (artStyle: string, manualKey: string) => string | null } = {},
): { orchestration: ReturnType<typeof createAssetPromptOrchestration>; calls: { system: string; user: string }[] } {
  const calls: { system: string; user: string }[] = [];
  const visualManual = overrides.visualManual ?? (() => "国风3D视觉手册：深色漆面、规整石基，避免现代元素。");
  const dependencies: AssetPromptOrchestrationDependencies = {
    work: workOf(knex),
    analyze: async (input) => {
      calls.push(input);
      return analyzeImpl(input);
    },
    loadSkillFile: async (relativePath) => {
      try {
        return fs.readFileSync(path.join(SKILL_ROOT, ...relativePath.split("/")), "utf-8");
      } catch {
        return null;
      }
    },
    getArtStylePrefix: async () => "国风3D渲染",
    getVisualManual: async (artStyle, manualKey) => visualManual(artStyle, manualKey),
    now: () => 1700000000000,
  };
  return { orchestration: createAssetPromptOrchestration(dependencies), calls };
}

test("一次模型调用生成整批资产提示词并持久化版本与来源哈希", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-orch-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assetReference").insert(referenceRow());
    const { orchestration, calls } = harness(knex, () => goldenBatchWithReference());

    const result = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(calls.length, 1, "整批资产必须只调用一次 Text Model");
    assert.equal(result.value.entries.length, 2);

    const system = calls[0].system;
    const user = calls[0].user;
    assert.ok(system.includes("资产视觉开发总监"), "system prompt 必须来自 #29 的 batch_asset_analysis.md 模板");
    assert.ok(user.includes("## FULL_SCRIPT"), "输入必须包含完整 Script 分区");
    assert.ok(user.includes("章台宫"), "输入必须包含 Script 正文");
    assert.ok(user.includes("## SELECTED_ASSETS"), "输入必须包含资产清单分区");
    assert.ok(user.includes("胡亥") && user.includes("吴广"));
    assert.ok(user.includes("## ASSET_REFERENCES"), "输入必须包含参考图契约分区");
    assert.ok(user.includes("正面半身标准像，玄色礼制外袍，束发"), "参考图人工描述必须原样进入输入");
    assert.ok(user.includes("## OUTPUT_SCHEMA"), "输入必须包含输出 Schema");
    assert.ok(user.includes("## VISUAL_MANUAL"), "输入必须包含项目视觉规范分区");
    assert.ok(user.includes("深色漆面"), "视觉手册内容必须进入分析输入");

    const rows = await knex("o_assets").whereIn("id", [101, 102]).select();
    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.equal(byId.get(101)!.promptState, "已完成");
    assert.equal(byId.get(102)!.promptState, "已完成");
    const prompt101 = byId.get(101)!.prompt;
    const prompt102 = byId.get(102)!.prompt;
    assert.ok(prompt101 && prompt101.length > 0);
    assert.ok(prompt102 && prompt102.length > 0);
    assert.notEqual(prompt101, prompt102, "胡亥与吴广不得生成同质化提示词");
    assert.ok(prompt101!.includes("人工描述：正面半身标准像，玄色礼制外袍，束发"), "参考约束必须进入最终提示词");
    assert.ok(!prompt102!.includes("参考图"), "无参考图资产不得出现任何参考措辞");

    const records = await knex("o_assetPromptRecord").whereIn("assetsId", [101, 102]).select();
    assert.equal(records.length, 2);
    for (const record of records) {
      assert.equal(record.skillVersion, ASSET_PROMPTING_SKILL_VERSION);
      assert.match(record.templateHash, /^[0-9a-f]{64}$/);
      assert.match(record.contextHash, /^[0-9a-f]{64}$/);
      assert.match(record.referenceHash, /^[0-9a-f]{64}$/);
      assert.deepEqual(JSON.parse(record.modelProfile), {
        referenceMode: "multi",
        maxReferences: 6,
        languageProfile: "zh-CN",
      });
      assert.equal(record.validationState, "validated");
      const brief = JSON.parse(record.assetBrief);
      assert.equal(brief.assetId, record.assetsId);
      assert.equal(record.generationPrompt, byId.get(record.assetsId)!.prompt);
    }
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("otherTextPrompt 缺省合法并作为额外要求进入提示词", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-extra-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assetReference").insert(referenceRow());
    const { orchestration } = harness(knex, () => goldenBatchWithReference());

    const missing = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });
    assert.equal(missing.ok, true, "otherTextPrompt 不再是必填项");

    const withExtra = await orchestration.generateBatchAssetPrompts({
      projectId: 1,
      assetsIds: [101, 102],
      otherTextPrompt: "参考秦代礼制冕服的十二章纹",
    });
    assert.equal(withExtra.ok, true);
    if (!withExtra.ok) return;
    const row = await knex("o_assets").where("id", 101).first();
    assert.ok(row.prompt.includes("额外要求：参考秦代礼制冕服的十二章纹"));
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("输入未变化时复用已持久化结果且不再调用模型", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-reuse-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assetReference").insert(referenceRow());
    const { orchestration, calls } = harness(knex, () => goldenBatchWithReference());

    await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });
    const firstPrompt = (await knex("o_assets").where("id", 101).first()).prompt;

    const second = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(calls.length, 1, "相同输入必须复用而不再次调用模型");
    assert.ok(second.value.entries.every((entry) => entry.reused));
    assert.equal((await knex("o_assets").where("id", 101).first()).prompt, firstPrompt);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Script 变化后旧提示词失效并触发重新生成", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-script-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assetReference").insert(referenceRow());
    const { orchestration, calls } = harness(knex, () => goldenBatchWithReference());

    await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });
    assert.equal(calls.length, 1);

    await knex("o_script").where("id", 11).update({ content: SCRIPT_CONTENT + "\n新增剧情：吴广在雨夜召集部众。" });
    const second = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });
    assert.equal(second.ok, true);
    assert.equal(calls.length, 2, "Script 变化必须触发重新生成");
    if (second.ok) assert.ok(second.value.entries.every((entry) => !entry.reused));
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("参考图描述变化后旧提示词失效并触发重新生成", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-ref-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assetReference").insert(referenceRow());
    const { orchestration, calls } = harness(knex, () => goldenBatchWithReference());

    await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });
    assert.equal(calls.length, 1);

    await knex("o_assetReference").where("id", 1).update({ description: "侧面全身像，玄色礼制外袍" });
    const second = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });
    assert.equal(second.ok, true);
    assert.equal(calls.length, 2, "参考图契约变化必须触发重新生成");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("模型返回非法 JSON 时结构化失败且不覆盖旧提示词", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-bad-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assets").where("id", 101).update({ prompt: "旧的最终提示词", promptState: "已完成" });
    const { orchestration } = harness(knex, () => "这不是 JSON，而是模型自由发挥的散文");

    const result = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "malformedOutput");

    const row = await knex("o_assets").where("id", 101).first();
    assert.equal(row.prompt, "旧的最终提示词", "失败不得覆盖最后一个有效 prompt");
    assert.equal(row.promptState, "生成失败");
    assert.ok(String(row.promptErrorReason).includes("malformedOutput"));
    const records = await knex("o_assetPromptRecord").select();
    assert.equal(records.length, 0, "失败不得写入 Brief 记录");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("模型抛出原始异常时返回结构化失败且不泄露异常细节", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-throw-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const { orchestration } = harness(knex, () => {
      throw new Error("API key sk-secret-123 exhausted");
    });

    const result = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "analysisFailed");
    assert.ok(!result.failure.message.includes("sk-secret-123"), "不得把模型原始异常泄露给调用方");
    const row = await knex("o_assets").where("id", 101).first();
    assert.equal(row.promptState, "生成失败");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("模型缺失资产结果时拒绝 missingAssetResult", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-miss-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const batch = goldenBatchWithReference();
    batch.assetBriefs = batch.assetBriefs.filter((brief) => brief.assetId === 101);
    const { orchestration } = harness(knex, () => batch);

    const result = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "missingAssetResult");
    assert.ok(result.failure.message.includes("102"));
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("资产类型未知时拒绝 unsupportedAssetType", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-type-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assets").where("id", 102).update({ type: "moodBoard" });
    const { orchestration } = harness(knex, () => goldenBatchWithReference());

    const result = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "unsupportedAssetType");
    const failed = await knex("o_assets").whereIn("id", [101, 102]).select();
    assert.ok(failed.every((row) => row.promptState === "生成失败"), "早期失败也必须把资产标记为生成失败");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("项目或资产不存在时返回结构化失败", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-404-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const { orchestration } = harness(knex, () => goldenBatchWithReference());

    const noProject = await orchestration.generateBatchAssetPrompts({ projectId: 999, assetsIds: [101] });
    assert.equal(noProject.ok, false);
    if (!noProject.ok) assert.equal(noProject.failure.kind, "projectNotFound");

    const noAsset = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [999] });
    assert.equal(noAsset.ok, false);
    if (!noAsset.ok) assert.equal(noAsset.failure.kind, "assetNotFound");

    await knex("o_assets").where("id", 102).update({ projectId: 2 });
    const mismatch = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [102] });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.failure.kind, "assetProjectMismatch");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("技能契约缺失时返回 skillContractMissing", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-skill-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const dependencies: AssetPromptOrchestrationDependencies = {
      work: workOf(knex),
      analyze: async () => {
        throw new Error("不应被调用");
      },
      loadSkillFile: async () => null,
      getArtStylePrefix: async () => null,
      getVisualManual: async () => null,
      now: () => 1700000000000,
    };
    const orchestration = createAssetPromptOrchestration(dependencies);
    const result = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "skillContractMissing");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("场景、基础道具与 Derived Prop 一次调用编译且继承父资产", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-multi-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const { orchestration, calls } = harness(knex, () => multiTypeBatch());

    const result = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [201, 301, 302] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(calls.length, 1);

    const scene = await knex("o_assets").where("id", 201).first();
    const prop = await knex("o_assets").where("id", 301).first();
    const derived = await knex("o_assets").where("id", 302).first();
    assert.ok(scene.prompt.includes("高台"), "场景必须保留地标");
    assert.ok(scene.prompt.includes("维护严整"), "场景必须保留维护状态");
    assert.ok(scene.prompt.includes("无人物"), "场景必须保留无人约束");
    assert.ok(prop.prompt.includes("误期名册木牍"));
    assert.ok(!prop.prompt.includes("父资产"), "基础道具不引用父资产");
    assert.ok(derived.prompt.includes("父资产误期名册木牍"), "Derived Prop 必须继承父资产锚点");
    assert.ok(derived.prompt.includes("暴雨浸湿"), "Derived Prop 只改变剧情状态");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("旧接口字段兼容：items 别名收敛、otherTextPrompt 可缺省、重复资产去重", () => {
  const normalized = normalizeBatchPromptRequest({
    projectId: 1,
    items: [
      { assetsId: 101, type: "role", name: "胡亥", describe: "皇帝" },
      { assetsId: 302, type: "tool", name: "浸湿名册", describe: "衍生道具" },
      { assetsId: 101, type: "role", name: "胡亥", describe: "皇帝" },
    ],
    concurrentCount: 3,
  });
  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;
  assert.deepEqual(normalized.value.assetsIds, [101, 302]);
  assert.equal(normalized.value.projectId, 1);
  assert.equal(normalized.value.otherTextPrompt, null);

  const withOther = normalizeBatchPromptRequest({
    projectId: 1,
    items: [{ assetsId: 101, type: "role", name: "胡亥", describe: "皇帝" }],
    otherTextPrompt: "补充要求",
  });
  assert.equal(withOther.ok, true);
  if (withOther.ok) assert.equal(withOther.value.otherTextPrompt, "补充要求");

  const empty = normalizeBatchPromptRequest({ projectId: 1, items: [] });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.failure.kind, "invalidRequest");
});

test("视觉手册作为项目视觉规范进入分析输入且内容变化触发失效", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-manual-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_assetReference").insert(referenceRow());
    let manualContent = "国风3D视觉手册第一版：深色漆面与规整石基。";
    const { orchestration, calls } = harness(knex, () => goldenBatchWithReference(), {
      visualManual: () => manualContent,
    });

    const first = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });
    assert.equal(first.ok, true);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].user.includes("国风3D视觉手册第一版"));

    manualContent = "国风3D视觉手册第二版：改用暖色漆面。";
    const second = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });
    assert.equal(second.ok, true);
    assert.equal(calls.length, 2, "视觉手册变化必须触发重新生成");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("美术风格设置了但视觉手册缺失时拒绝 visualManualMissing 并标记生成失败", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-nomanual-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const { orchestration } = harness(knex, () => goldenBatchWithReference(), {
      visualManual: () => null,
    });

    const result = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, "visualManualMissing");
    const row = await knex("o_assets").where("id", 101).first();
    assert.equal(row.promptState, "生成失败");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("上下文加载失败时也将资产标记为生成失败（批量后台反馈）", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-early-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    await knex("o_script").where("id", 11).delete();
    const { orchestration } = harness(knex, () => goldenBatchWithReference());

    const result = await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101, 102] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, "scriptNotFound");
    const rows = await knex("o_assets").whereIn("id", [101, 102]).select();
    assert.ok(rows.every((row) => row.promptState === "生成失败"), "上下文加载失败不得让资产停留在旧状态");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("删除资产时同步清理提示词记录", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-asset-prompt-purge-");
  try {
    await prepareSchema(knex);
    await seedBasics(knex);
    const { orchestration } = harness(knex, () => {
      const batch = goldenBatchWithReference();
      // 本测试不插入参考图行，因此剥离 golden fixture 中携带的参考绑定
      batch.assetBriefs = batch.assetBriefs.filter((brief) => brief.assetId === 101).map((brief) => ({ ...brief, referenceBindings: [] }));
      return batch;
    });

    await orchestration.generateBatchAssetPrompts({ projectId: 1, assetsIds: [101] });
    assert.equal((await knex("o_assetPromptRecord").select()).length, 1);

    await workOf(knex)((db) => removeAssetPromptRecordRows(db, [101]));
    assert.equal((await knex("o_assetPromptRecord").select()).length, 0, "删除资产必须清理提示词记录");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("失败信封把 kind 映射为稳定状态码与文案", () => {
  const notFound = assetPromptErrorEnvelope({ kind: "projectNotFound", message: "whatever" });
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.error, "projectNotFound");

  const malformed = assetPromptErrorEnvelope({ kind: "malformedOutput", message: "whatever" });
  assert.equal(malformed.status, 502);
  assert.equal(malformed.body.error, "malformedOutput");
  assert.ok(malformed.body.message.length > 0);
  assert.ok(!malformed.body.message.includes("whatever"), "信封文案来自映射而不是原始异常");

  const unavailable = assetPromptErrorEnvelope({ kind: "languageProfileNotAvailable", message: "whatever" });
  assert.equal(unavailable.status, 400);
});
