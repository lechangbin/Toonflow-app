import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AGNES_IMAGE_2_1_FLASH_PROFILE,
  compileAssetGenerationPrompt,
  type AssetPromptModelProfile,
} from "../src/assets/assetPromptCompiler";
import type { AssetBrief, AssetReferenceBinding } from "../src/assets/assetBriefContract";

const SKILL_ROOT = path.resolve(process.cwd(), "data", "skills", "asset-prompting");

function loadJson(...parts: string[]): Record<string, any> {
  return JSON.parse(readFileSync(path.join(SKILL_ROOT, ...parts), "utf8"));
}

function loadGoldenBrief(assetId: number): AssetBrief {
  const batch = loadJson("fixtures", "historical-character-contrast.expected.json");
  return batch.assetBriefs.find((brief: any) => brief.assetId === assetId);
}

function binding(overrides: Partial<AssetReferenceBinding>): AssetReferenceBinding {
  return {
    referenceId: "ref-1",
    label: "参考图A",
    description: "人工描述原文。",
    primaryRole: "identity",
    subjectSelector: "画面中央主体",
    mustPreserve: ["必须继承项"],
    mustIgnore: ["背景"],
    controlledDimensions: ["faceTopology"],
    priority: 1,
    evidenceSource: "manual",
    ...overrides,
  };
}

function sceneBrief(): AssetBrief {
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

function propBrief(derived: boolean, name = "误期名册木牍"): AssetBrief {
  return {
    assetId: derived ? 302 : 301,
    assetType: "prop",
    isDerived: derived,
    parentAssetId: derived ? 301 : null,
    name,
    narrativeFunction: "记录戍卒姓名与到期日期，是戍卒误期证据，也是误期危机中的官府登记凭据",
    eraRegion: "秦末大泽乡",
    evidence: [{ source: "script", fact: "误期名册", locator: "scriptExcerpt[0]", confidence: "explicit" }],
    immutable: derived
      ? ["窄长木牍几何", "麻绳编联结构", "官府登记身份", "前臂相对尺度"]
      : ["窄长木牍几何"],
    flexible: ["麻绳打结位置"],
    storyChanging: derived ? ["暴雨浸湿", "轻微翘曲", "墨迹局部晕染", "麻绳吸水变深"] : [],
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
      wearRepairHistory: "边角频繁翻检磨损并逐渐变圆，麻绳局部发毛并有重新打结痕迹",
      distinctiveMarks: ["官府登记行列"],
      continuity: "登记行列清晰可辨",
      negativeIdentity: ["不是华贵玉器"],
    },
  } as AssetBrief;
}

test("参考契约片段与 golden fixture 完全一致（含人工描述原文）", () => {
  const crossType = loadJson("fixtures", "cross-type-compiler-cases.json");
  const brief = loadGoldenBrief(101);
  const withBindings = { ...brief, referenceBindings: crossType.referenceContract.bindings } as AssetBrief;
  const result = compileAssetGenerationPrompt({
    brief: withBindings,
    modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE,
  });
  assert.ok(result.ok, result.ok ? "" : result.failure.message);
  if (result.ok) {
    assert.ok(result.value.generationPrompt.includes(crossType.referenceContract.expectedClause));
    assert.equal(result.value.selectedBindings.length, 2);
  }
});

test("无参考图时提示词不出现任何参考措辞", () => {
  const brief = loadGoldenBrief(101);
  const result = compileAssetGenerationPrompt({ brief, modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE });
  assert.ok(result.ok);
  if (result.ok) {
    assert.ok(!result.value.generationPrompt.includes("参考"));
    assert.equal(result.value.referenceClause, "");
    assert.equal(result.value.selectedBindings.length, 0);
  }
});

test("胡亥与吴广编译结果保持差异、不回落通用短语", () => {
  const huHai = compileAssetGenerationPrompt({ brief: loadGoldenBrief(101), modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE });
  const wuGuang = compileAssetGenerationPrompt({ brief: loadGoldenBrief(102), modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE });
  assert.ok(huHai.ok && wuGuang.ok);
  if (huHai.ok && wuGuang.ok) {
    const p1 = huHai.value.generationPrompt;
    const p2 = wuGuang.value.generationPrompt;
    assert.ok(p1.includes("胡亥") && p2.includes("吴广"));
    assert.notEqual(p1, p2);
    assert.ok(p1.includes("玄黑礼制长袍"));
    assert.ok(p2.includes("粗麻短褐"));
    for (const phrase of ["半束长发", "素色古装长衫", "基础色、无花纹装饰"]) {
      const collision = [p1, p2].filter((p) => p.includes(phrase)).length;
      assert.ok(collision < 2, `两个提示词都回落到通用短语: ${phrase}`);
    }
    // 身份信息在渲染质量约束之前（compile 模板规则 1）
    assert.ok(p1.indexOf("胡亥") < p1.indexOf("角色四视图设定图"));
  }
});

test("同一 controlledDimension 冲突时按优先级稳定裁决", () => {
  const brief = loadGoldenBrief(101);
  const withConflict = {
    ...brief,
    referenceBindings: [
      binding({ referenceId: "ref-2", label: "参考图B", priority: 2, controlledDimensions: ["faceTopology", "robeTexture"] }),
      binding({ referenceId: "ref-1", label: "参考图A", priority: 1, controlledDimensions: ["faceTopology"] }),
    ],
  } as AssetBrief;
  const result = compileAssetGenerationPrompt({ brief: withConflict, modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE });
  assert.ok(result.ok);
  if (result.ok) {
    // 参考图A 赢得 faceTopology；参考图B 仅保留 robeTexture
    assert.ok(result.value.generationPrompt.includes("仅控制faceTopology"));
    assert.ok(result.value.generationPrompt.includes("仅控制robeTexture"));
    assert.ok(!/仅控制faceTopology、robeTexture|仅控制robeTexture、faceTopology/u.test(result.value.generationPrompt));
  }
});

test("参考图全部维度被夺走时不进入本次生成", () => {
  const brief = loadGoldenBrief(101);
  const withConflict = {
    ...brief,
    referenceBindings: [
      binding({ referenceId: "ref-2", label: "参考图B", priority: 2, controlledDimensions: ["faceTopology"] }),
      binding({ referenceId: "ref-1", label: "参考图A", priority: 1, controlledDimensions: ["faceTopology"] }),
    ],
  } as AssetBrief;
  const result = compileAssetGenerationPrompt({ brief: withConflict, modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.value.selectedBindings.length, 1);
    assert.ok(result.value.generationPrompt.includes("参考图A"));
    assert.ok(!result.value.generationPrompt.includes("参考图B"));
  }
});

test("超过上限时按优先级与覆盖度稳定截断到 6 张", () => {
  const brief = loadGoldenBrief(101);
  const bindings = Array.from({ length: 7 }, (_, i) =>
    binding({ referenceId: `ref-${i + 1}`, label: `参考图${i + 1}`, priority: i + 1, controlledDimensions: [`dim${i + 1}`] }),
  );
  const result = compileAssetGenerationPrompt({
    brief: { ...brief, referenceBindings: bindings } as AssetBrief,
    modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE,
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.value.selectedBindings.length, 6);
    assert.ok(!result.value.generationPrompt.includes("参考图7"));
    assert.ok(result.value.generationPrompt.includes("参考图1"));
  }
});

test("single 模式只保留一张最高优先级参考图", () => {
  const profile: AssetPromptModelProfile = { referenceMode: "single", maxReferences: 1, languageProfile: "zh-CN" };
  const brief = loadGoldenBrief(101);
  const result = compileAssetGenerationPrompt({
    brief: {
      ...brief,
      referenceBindings: [
        binding({ referenceId: "ref-2", label: "参考图B", priority: 2 }),
        binding({ referenceId: "ref-1", label: "参考图A", priority: 1 }),
      ],
    } as AssetBrief,
    modelProfile: profile,
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.value.selectedBindings.length, 1);
    assert.ok(result.value.generationPrompt.includes("参考图A"));
    assert.ok(!result.value.generationPrompt.includes("参考图B"));
  }
});

test("场景编译保留空间身份、地标与无人约束", () => {
  const result = compileAssetGenerationPrompt({ brief: sceneBrief(), modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE });
  assert.ok(result.ok, result.ok ? "" : result.failure.message);
  if (result.ok) {
    const prompt = result.value.generationPrompt;
    assert.ok(prompt.includes("章台宫奏牍殿"));
    assert.ok(prompt.includes("纵深中轴"));
    assert.ok(prompt.includes("高台御座"));
    assert.ok(prompt.includes("维护严整"));
    assert.ok(prompt.includes("无人"));
    assert.ok(prompt.includes("不是通用豪华大殿"));
    assert.ok(!prompt.includes("参考"));
  }
});

test("基础道具编译保持纯道具隔离与剧情证据", () => {
  const result = compileAssetGenerationPrompt({ brief: propBrief(false), modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE });
  assert.ok(result.ok);
  if (result.ok) {
    const prompt = result.value.generationPrompt;
    assert.ok(prompt.includes("evidence prop"));
    assert.ok(prompt.includes("戍卒误期证据"));
    assert.ok(/无人物、无手部、无人持有/u.test(prompt));
    assert.ok(prompt.includes("华贵玉器") === false || prompt.includes("不使用"));
  }
});

test("Derived Prop 继承父身份锚点并叠加剧情状态", () => {
  const result = compileAssetGenerationPrompt({
    brief: propBrief(true, "暴雨浸湿的误期名册木牍"),
    parentAsset: { id: 301, name: "误期名册木牍" },
    modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE,
  });
  assert.ok(result.ok);
  if (result.ok) {
    const prompt = result.value.generationPrompt;
    assert.ok(prompt.includes("误期名册木牍"));
    for (const anchor of ["窄长木牍几何", "麻绳编联结构", "官府登记身份", "前臂相对尺度"]) {
      assert.ok(prompt.includes(anchor), `丢失父身份锚点: ${anchor}`);
    }
    for (const change of ["暴雨浸湿", "轻微翘曲", "墨迹局部晕染", "麻绳吸水变深"]) {
      assert.ok(prompt.includes(change), `丢失剧情状态: ${change}`);
    }
    assert.ok(/无人物、无手部、无人持有/u.test(prompt));
  }
});

test("无人与纯道具约束由编译器确定性保证（不依赖模型 prohibitedElements）", () => {
  const scene = sceneBrief();
  scene.generationRequirements.prohibitedElements = [];
  const sceneResult = compileAssetGenerationPrompt({ brief: scene, modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE });
  assert.ok(sceneResult.ok);
  if (sceneResult.ok) {
    assert.ok(sceneResult.value.generationPrompt.includes("画面中不出现任何人物"), "场景无人约束必须由编译器保证");
  }

  const prop = propBrief(false);
  prop.generationRequirements.prohibitedElements = [];
  const propResult = compileAssetGenerationPrompt({ brief: prop, modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE });
  assert.ok(propResult.ok);
  if (propResult.ok) {
    const prompt = propResult.value.generationPrompt;
    assert.ok(prompt.includes("纯道具"), "道具必须保持纯道具约束");
    assert.ok(prompt.includes("不出现人物"), "道具画面必须排除人物");
    assert.ok(prompt.includes("持握"), "道具画面必须排除持握关系");
  }
});

test("未注册的英文 language profile 返回结构化失败", () => {
  const profile: AssetPromptModelProfile = { referenceMode: "multi", maxReferences: 6, languageProfile: "en" };
  const result = compileAssetGenerationPrompt({ brief: loadGoldenBrief(101), modelProfile: profile });
  assert.ok(!result.ok && result.failure.kind === "languageProfileNotAvailable");
});

test("额外要求与美术风格前缀进入最终提示词", () => {
  const result = compileAssetGenerationPrompt({
    brief: loadGoldenBrief(101),
    modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE,
    additionalRequirements: "面容保持年轻但威严",
    artStylePrefix: "国风3D渲染，高精度建模，PBR材质。",
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.ok(result.value.generationPrompt.includes("面容保持年轻但威严"));
    assert.ok(result.value.generationPrompt.includes("国风3D渲染，高精度建模，PBR材质"));
    assert.ok(result.value.generationPrompt.trimEnd().endsWith("。"));
  }
});
