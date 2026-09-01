import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  assetBriefBatchSchema,
  canonicalAssetBriefType,
  parseAnalysisOutput,
  validateAssetBriefBatch,
  type ExpectedAssetInput,
} from "../src/assets/assetBriefContract";
import type { AssetReferenceRecord } from "../src/assets/assetReferences";

const SKILL_ROOT = path.resolve(process.cwd(), "data", "skills", "asset-prompting");

function loadGoldenBatch(): Record<string, any> {
  return JSON.parse(readFileSync(path.join(SKILL_ROOT, "fixtures", "historical-character-contrast.expected.json"), "utf8"));
}

function makeReference(overrides: Partial<AssetReferenceRecord> = {}): AssetReferenceRecord {
  return {
    id: 501,
    projectId: 1,
    assetsId: 101,
    mediaPath: "/1/assetReferences/501.png",
    mediaMime: "image/png",
    orderIndex: 0,
    description: "只参考图中年轻男性的脸部骨相，不参考服装和背景。",
    descriptionSource: "manual",
    analysisState: "not_requested",
    visualRole: "胡亥面容",
    requiredTransfers: ["脸部骨相"],
    exclusions: ["服装", "背景"],
    createTime: 1,
    updateTime: 1,
    ...overrides,
  };
}

function makeCharacterBrief(assetId: number, name: string, overrides: Record<string, any> = {}) {
  return {
    assetId,
    assetType: "character",
    isDerived: false,
    parentAssetId: null,
    name,
    narrativeFunction: "在危机中做决定的统治者",
    eraRegion: "秦末咸阳宫廷",
    evidence: [{ source: "script", fact: "身居帝位", locator: "scriptExcerpt[0]", confidence: "explicit" }],
    immutable: ["皇帝身份"],
    flexible: ["微表情强弱"],
    storyChanging: ["奏牍压力下的紧张"],
    differenceAnchors: [
      { dimension: "socialRole", value: "礼制顶端的皇帝", reason: "剧本明确" },
      { dimension: "wardrobeStructure", value: "玄黑多层礼袍", reason: "剧本明确" },
    ],
    forbiddenDefaults: ["粗麻短褐"],
    contrastAgainstSiblingAssets: [],
    referenceBindings: [],
    generationRequirements: {
      outputFormat: "角色四视图设定图",
      composition: "头肩特写、正视全身、侧视全身、后视全身",
      background: "素灰纯色背景，均匀柔光",
      requiredElements: ["完整头顶至脚底"],
      prohibitedElements: ["文字", "场景"],
      aspectRatio: "4:1",
    },
    design: {
      identitySummary: "年轻皇帝",
      socialRole: "皇帝",
      profession: "统治者",
      agePresentation: "年轻成年男性",
      personalityContradiction: "威权与迟疑并存",
      silhouette: "封闭垂直宫廷轮廓",
      faceTopology: "年轻养尊处优",
      hairStructure: "宫廷规整高束",
      bodyPosture: "重心略后",
      wardrobeStructure: "玄黑多层礼袍",
      materialsCraft: "细密绢织",
      wearHistory: "洁净无磨损",
      signatureMarks: ["玄黑礼制轮廓"],
      negativeIdentity: ["不是戍卒"],
    },
    ...overrides,
  };
}

function expectedCharacter(assetsId: number, references: AssetReferenceRecord[] = []): ExpectedAssetInput {
  return { assetsId, briefType: "character", isDerived: false, parentAssetId: null, references };
}

test("golden fixture batch 通过 zod 镜像 Schema 校验", () => {
  const golden = loadGoldenBatch();
  const parsed = assetBriefBatchSchema.safeParse(golden);
  assert.ok(parsed.success, `golden fixture 必须通过镜像校验: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
});

test("canonicalAssetBriefType 支持 role/scene/tool 及复数别名", () => {
  assert.equal(canonicalAssetBriefType("role"), "character");
  assert.equal(canonicalAssetBriefType("character"), "character");
  assert.equal(canonicalAssetBriefType("characters"), "character");
  assert.equal(canonicalAssetBriefType("scene"), "scene");
  assert.equal(canonicalAssetBriefType("scenes"), "scene");
  assert.equal(canonicalAssetBriefType("tool"), "prop");
  assert.equal(canonicalAssetBriefType("prop"), "prop");
  assert.equal(canonicalAssetBriefType("props"), "prop");
  assert.equal(canonicalAssetBriefType("unknown"), null);
});

test("parseAnalysisOutput 透传对象、解析围栏 JSON 字符串、拒绝非法文本", () => {
  const objectResult = parseAnalysisOutput({ schemaVersion: "1.0" });
  assert.ok(objectResult.ok && objectResult.value === objectResult.value);

  const fenced = parseAnalysisOutput('```json\n{"schemaVersion": "1.0"}\n```');
  assert.ok(fenced.ok);
  assert.deepEqual(fenced.ok && fenced.value, { schemaVersion: "1.0" });

  const failure = parseAnalysisOutput("这不是 JSON");
  assert.ok(!failure.ok && failure.failure.kind === "malformedOutput");
});

test("validateAssetBriefBatch 接受 golden fixture 且无修复", () => {
  const golden = loadGoldenBatch();
  const result = validateAssetBriefBatch(golden, [
    expectedCharacter(101),
    expectedCharacter(102),
  ]);
  assert.ok(result.ok, result.ok ? "" : result.failure.message);
  if (result.ok) {
    assert.equal(result.value.batch.assetBriefs.length, 2);
    assert.equal(result.value.repairs.length, 0);
  }
});

test("缺少资产结果时拒绝 missingAssetResult", () => {
  const batch = loadGoldenBatch();
  batch.assetBriefs = batch.assetBriefs.slice(0, 1);
  const result = validateAssetBriefBatch(batch, [expectedCharacter(101), expectedCharacter(102)]);
  assert.ok(!result.ok && result.failure.kind === "missingAssetResult");
});

test("重复资产结果时拒绝 duplicateAssetResult", () => {
  const batch = loadGoldenBatch();
  batch.assetBriefs = [batch.assetBriefs[0], batch.assetBriefs[0]];
  const result = validateAssetBriefBatch(batch, [expectedCharacter(101), expectedCharacter(102)]);
  assert.ok(!result.ok && result.failure.kind === "duplicateAssetResult");
});

test("未知资产结果时拒绝 unknownAssetResult", () => {
  const batch = loadGoldenBatch();
  batch.assetBriefs[1] = { ...batch.assetBriefs[1], assetId: 999 };
  const result = validateAssetBriefBatch(batch, [expectedCharacter(101), expectedCharacter(102)]);
  assert.ok(!result.ok && result.failure.kind === "unknownAssetResult");
});

test("资产类型不匹配时拒绝 assetTypeMismatch", () => {
  const batch = loadGoldenBatch();
  // 数据库认为 101 是场景，模型返回了合法的 character Brief
  const mismatched = [expectedCharacter(101), expectedCharacter(102)].map((item) =>
    item.assetsId === 101 ? { ...item, briefType: "scene" as const } : item,
  );
  const result = validateAssetBriefBatch(batch, mismatched);
  assert.ok(!result.ok && result.failure.kind === "assetTypeMismatch");
});

test("衍生身份与父资产不符时拒绝 derivedMismatch", () => {
  const brief = makeCharacterBrief(103, "暴雨中的胡亥", {
    isDerived: true,
    parentAssetId: 101,
  });
  const batch = {
    schemaVersion: "1.0",
    language: "zh-CN",
    worldBible: loadGoldenBatch().worldBible,
    contrastMatrix: [],
    assetBriefs: [brief],
  };
  // 数据库认为 103 不是衍生资产
  const result = validateAssetBriefBatch(batch, [{ assetsId: 103, briefType: "character", isDerived: false, parentAssetId: null, references: [] }]);
  assert.ok(!result.ok && result.failure.kind === "derivedMismatch");
});

test("无参考图的资产出现参考绑定时拒绝 referenceBindingMismatch", () => {
  const binding = {
    referenceId: "ref-501",
    label: "胡亥面容",
    description: "只参考图中年轻男性的脸部骨相，不参考服装和背景。",
    primaryRole: "identity",
    subjectSelector: "画面中央男性的面部",
    mustPreserve: ["脸部骨相"],
    mustIgnore: ["服装"],
    controlledDimensions: ["faceTopology"],
    priority: 1,
    evidenceSource: "manual",
  };
  const brief = makeCharacterBrief(101, "胡亥", { referenceBindings: [binding] });
  const batch = {
    schemaVersion: "1.0",
    language: "zh-CN",
    worldBible: loadGoldenBatch().worldBible,
    contrastMatrix: [],
    assetBriefs: [brief],
  };
  const result = validateAssetBriefBatch(batch, [expectedCharacter(101, [])]);
  assert.ok(!result.ok && result.failure.kind === "referenceBindingMismatch");
});

test("有参考图的资产缺少参考绑定时拒绝 referenceBindingMismatch", () => {
  const batch = loadGoldenBatch();
  batch.assetBriefs = batch.assetBriefs.slice(0, 1);
  const result = validateAssetBriefBatch(batch, [expectedCharacter(101, [makeReference()])]);
  assert.ok(!result.ok && result.failure.kind === "referenceBindingMismatch");
});

test("部分人工参考图缺少绑定时拒绝 referenceBindingMismatch", () => {
  const binding = {
    referenceId: "ref-501",
    label: "胡亥面容",
    description: "只参考图中年轻男性的脸部骨相，不参考服装和背景。",
    primaryRole: "identity",
    subjectSelector: "画面中央男性的面部",
    mustPreserve: ["脸部骨相"],
    mustIgnore: ["服装"],
    controlledDimensions: ["faceTopology"],
    priority: 1,
    evidenceSource: "manual",
  };
  const brief = makeCharacterBrief(101, "胡亥", { referenceBindings: [binding] });
  const batch = {
    schemaVersion: "1.0",
    language: "zh-CN",
    worldBible: loadGoldenBatch().worldBible,
    contrastMatrix: [],
    assetBriefs: [brief],
  };
  // 资产持有 ref-501 与 ref-502 两张人工参考图，模型只绑定了 ref-501
  const second = makeReference({ id: 502, orderIndex: 1, visualRole: "胡亥全身像", description: "全身像参考。" });
  const result = validateAssetBriefBatch(batch, [expectedCharacter(101, [makeReference(), second])]);
  assert.ok(!result.ok && result.failure.kind === "referenceBindingMismatch");
});

test("同一参考图被重复绑定时拒绝 referenceBindingMismatch", () => {
  const binding = {
    referenceId: "ref-501",
    label: "胡亥面容",
    description: "只参考图中年轻男性的脸部骨相，不参考服装和背景。",
    primaryRole: "identity",
    subjectSelector: "画面中央男性的面部",
    mustPreserve: ["脸部骨相"],
    mustIgnore: ["服装"],
    controlledDimensions: ["faceTopology"],
    priority: 1,
    evidenceSource: "manual",
  };
  const duplicate = { ...binding, priority: 2 };
  const brief = makeCharacterBrief(101, "胡亥", { referenceBindings: [binding, duplicate] });
  const batch = {
    schemaVersion: "1.0",
    language: "zh-CN",
    worldBible: loadGoldenBatch().worldBible,
    contrastMatrix: [],
    assetBriefs: [brief],
  };
  const result = validateAssetBriefBatch(batch, [expectedCharacter(101, [makeReference()])]);
  assert.ok(!result.ok && result.failure.kind === "referenceBindingMismatch");
});

test("模型篡改人工描述与标签时被修复为持久化原文", () => {
  const binding = {
    referenceId: "ref-501",
    label: "模型改过的标签",
    description: "模型润色过的描述",
    primaryRole: "identity",
    subjectSelector: "画面中央男性的面部",
    mustPreserve: ["脸部骨相"],
    mustIgnore: ["服装"],
    controlledDimensions: ["faceTopology"],
    priority: 1,
    evidenceSource: "manual",
  };
  const brief = makeCharacterBrief(101, "胡亥", { referenceBindings: [binding] });
  const batch = {
    schemaVersion: "1.0",
    language: "zh-CN",
    worldBible: loadGoldenBatch().worldBible,
    contrastMatrix: [],
    assetBriefs: [brief],
  };
  const reference = makeReference();
  const result = validateAssetBriefBatch(batch, [expectedCharacter(101, [reference])]);
  assert.ok(result.ok, result.ok ? "" : result.failure.message);
  if (result.ok) {
    const repaired = result.value.batch.assetBriefs[0].referenceBindings[0];
    assert.equal(repaired.description, reference.description);
    assert.equal(repaired.label, reference.visualRole);
    assert.equal(result.value.repairs.length, 2);
    assert.equal(result.value.batch.assetBriefs[0].referenceBindings.length, 1);
  }
});

test("未知 referenceId 的绑定被丢弃后参考契约缺失则拒绝", () => {
  const unknownBinding = {
    referenceId: "ref-999",
    label: "不存在的参考图",
    description: "占位描述",
    primaryRole: "identity",
    subjectSelector: null,
    mustPreserve: ["任意"],
    mustIgnore: ["背景"],
    controlledDimensions: ["faceTopology"],
    priority: 1,
    evidenceSource: "manual",
  };
  const brief = makeCharacterBrief(101, "胡亥", { referenceBindings: [unknownBinding] });
  const batch = {
    schemaVersion: "1.0",
    language: "zh-CN",
    worldBible: loadGoldenBatch().worldBible,
    contrastMatrix: [],
    assetBriefs: [brief],
  };
  const result = validateAssetBriefBatch(batch, [expectedCharacter(101, [makeReference()])]);
  assert.ok(!result.ok && result.failure.kind === "referenceBindingMismatch");
});

test("结构不合法的输出拒绝 malformedOutput", () => {
  const result = validateAssetBriefBatch({ schemaVersion: "2.0" }, [expectedCharacter(101)]);
  assert.ok(!result.ok && result.failure.kind === "malformedOutput");
});
