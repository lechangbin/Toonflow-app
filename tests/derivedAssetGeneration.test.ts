import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import initDB from "../src/lib/initDB";
import { workOf } from "./databaseTestSupport";
import {
  isChangeKindCompatibleWithBriefType,
  legacyInstructionFromDescription,
  loadDerivedChangeInstruction,
  saveDerivedChangeInstruction,
  type DerivedChangeInstruction,
} from "../src/assets/derivedChangeInstruction";

/**
 * Issue #37：Derived Asset 走 Parent Asset Anchor + Derived Change Instruction
 * 的确定性生成链路。本文件按 seam 分层覆盖：
 *   1. 变化契约的持久化与版本（derivedChangeInstruction 模块）
 *   2. 旧 desc 的确定性兼容转换
 *   3. 提示词确定性编译与失效重编译（derivedAssetPrompt → resolve）
 *   4. 图片生成提交恰好一个父资产锚点（assetImageGeneration）
 *   5. Production Agent 批量路由迁移（batchGenerateAssetsImage 薄适配器）
 */

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

const WARDROBE_INSTRUCTION: DerivedChangeInstruction = {
  changeKind: "character_wardrobe",
  evidence: ["第三幕：胡亥换上玄色祭服。"],
  preserve: ["脸部拓扑", "体型轮廓", "发型结构"],
  change: ["服装由日常玄色外袍替换为祭天礼服"],
  exclude: ["背景变化", "文字"],
};

test("变化契约持久化为带版本记录并在更新时递增 revision", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-contract-");
  try {
    await prepareSchema(knex);
    await knex("o_project").insert({ id: 1, name: "项目", artStyle: "guofeng_3d" });
    await knex("o_assets").insert([
      { id: 101, name: "胡亥", type: "role", describe: "秦二世。", projectId: 1 },
      { id: 111, name: "祭服胡亥", type: "role", describe: "祭天礼服版本。", assetsId: 101, projectId: 1 },
    ]);

    const saved = await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: WARDROBE_INSTRUCTION,
      source: "agent",
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.value.revision, 1);
    assert.equal(saved.value.source, "agent");
    assert.deepEqual(saved.value.instruction, WARDROBE_INSTRUCTION);

    const updated = await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: { ...WARDROBE_INSTRUCTION, change: ["服装替换为甲胄"] },
      source: "agent",
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value.revision, 2, "同一衍生资产的契约更新必须递增 revision");
    assert.deepEqual(updated.value.instruction.change, ["服装替换为甲胄"]);

    const loaded = await loadDerivedChangeInstruction(workOf(knex), { projectId: 1, assetsId: 111 });
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.ok(loaded.value);
    assert.equal(loaded.value.revision, 2);
    assert.deepEqual(loaded.value.instruction, { ...WARDROBE_INSTRUCTION, change: ["服装替换为甲胄"] });

    const missing = await loadDerivedChangeInstruction(workOf(knex), { projectId: 1, assetsId: 101 });
    assert.equal(missing.ok && missing.value, null, "未写入契约的基础资产返回 null");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("loadDerivedChangeInstruction 校验 projectId 归属避免跨项目读取", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-contract-own-");
  try {
    await prepareSchema(knex);
    await knex("o_project").insert({ id: 1, name: "项目", artStyle: "guofeng_3d" });
    await knex("o_assets").insert([
      { id: 101, name: "胡亥", type: "role", describe: "秦二世。", projectId: 1 },
      { id: 111, name: "祭服胡亥", type: "role", describe: "祭天礼服版本。", assetsId: 101, projectId: 1 },
    ]);
    const saved = await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: WARDROBE_INSTRUCTION,
      source: "agent",
    });
    assert.equal(saved.ok, true);

    const foreign = await loadDerivedChangeInstruction(workOf(knex), { projectId: 2, assetsId: 111 });
    assert.equal(foreign.ok && foreign.value, null, "其它项目不得读取该契约");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("旧 desc 确定性转换为变化契约：类型映射 + preserve/exclude 默认值 + 不调用模型", () => {
  const role = legacyInstructionFromDescription({ describe: "换上祭天礼服 · 玄色广袖", briefType: "character" });
  assert.ok(role);
  assert.equal(role.changeKind, "character_wardrobe", "旧角色衍生按类型确定性映射 changeKind");
  assert.deepEqual(role.change, ["换上祭天礼服 · 玄色广袖"], "旧 desc 原文作为唯一允许变化");
  assert.ok(role.preserve.length > 0, "角色衍生必须补充类型化 preserve 默认值");
  assert.ok(role.exclude.length > 0, "角色衍生必须补充类型化 exclude 默认值");
  assert.deepEqual(role.evidence, [], "旧 desc 转换不虚构剧本证据");

  const scene = legacyInstructionFromDescription({ describe: "黄昏时分的章台宫", briefType: "scene" });
  assert.ok(scene);
  assert.equal(scene.changeKind, "scene_time");

  const prop = legacyInstructionFromDescription({ describe: "暴雨浸湿的名册", briefType: "prop" });
  assert.ok(prop);
  assert.equal(prop.changeKind, "legacy_prop_state", "现有 Derived Prop 通过 legacy_prop_state 保持兼容");

  assert.equal(
    legacyInstructionFromDescription({ describe: "   ", briefType: "character" }),
    null,
    "空 desc 无法确定性转换，必须重新分析",
  );
});

test("changeKind 与资产类型的一致性可被确定性校验", () => {
  assert.equal(isChangeKindCompatibleWithBriefType("character_wardrobe", "character"), true);
  assert.equal(isChangeKindCompatibleWithBriefType("character_morphology", "scene"), false);
  assert.equal(isChangeKindCompatibleWithBriefType("scene_time", "scene"), true);
  assert.equal(isChangeKindCompatibleWithBriefType("legacy_prop_state", "prop"), true);
  assert.equal(isChangeKindCompatibleWithBriefType("legacy_prop_state", "character"), false);
});
// ─── Slice 2：确定性提示词编译与解析（resolve seam） ─────────────────────────

import {
  resolveAssetGenerationInputs,
  type AssetPromptOrchestrationDependencies,
  type ResolvedAssetGenerationInput,
} from "../src/assets/assetPromptOrchestration";
import { DERIVED_ANCHOR_SKILL_VERSION } from "../src/assets/derivedAssetPrompt";

const SKILL_ROOT = path.resolve(process.cwd(), "data", "skills", "asset-prompting");

/** 衍生解析依赖：analyze 记录调用并抛错——衍生链路不得调用 Text Model。 */
function derivedHarness(
  knex: Knex,
  options: { manual?: () => string; omitBaseAnalysisTemplate?: boolean } = {},
): { dependencies: AssetPromptOrchestrationDependencies; textCalls: unknown[] } {
  const textCalls: unknown[] = [];
  const dependencies: AssetPromptOrchestrationDependencies = {
    work: workOf(knex),
    analyze: async (input) => {
      textCalls.push(input);
      throw new Error("衍生资产生成不得调用 Text Model");
    },
    loadSkillFile: async (relativePath) => {
      if (options.omitBaseAnalysisTemplate && relativePath === "prompts/batch_asset_analysis.md") return null;
      try {
        return fs.readFileSync(path.join(SKILL_ROOT, ...relativePath.split("/")), "utf8");
      } catch {
        return null;
      }
    },
    getArtStylePrefix: async () => "国风3D渲染",
    getVisualManual: async () => (options.manual ? options.manual() : "衍生视觉手册：继承父资产基准外观，仅应用声明变化。"),
    now: () => 1700000000000,
  };
  return { dependencies, textCalls };
}

interface DerivedSeedOptions {
  derivedId?: number;
  derivedType?: string;
  derivedDescribe?: string;
  parentImageId?: number | null;
}

async function seedDerivedSetup(knex: Knex, options: DerivedSeedOptions = {}): Promise<void> {
  const derivedId = options.derivedId ?? 111;
  await knex("o_project").insert({
    id: 1,
    name: "秦末项目",
    type: "短剧",
    intro: "秦末故事",
    artStyle: "guofeng_3d",
  });
  await knex("o_image").insert({ id: 501, assetsId: 101, type: "role", state: "已完成", filePath: "/1/role/parent.png" });
  await knex("o_assets").insert([
    {
      id: 101,
      name: "胡亥",
      type: "role",
      describe: "秦二世，年轻皇帝。",
      projectId: 1,
      imageId: options.parentImageId === undefined ? 501 : options.parentImageId,
    },
    {
      id: derivedId,
      name: options.derivedType === "scene" ? "黄昏章台宫" : "祭服胡亥",
      type: options.derivedType ?? "role",
      describe: options.derivedDescribe ?? "祭天礼服版本。",
      assetsId: 101,
      projectId: 1,
    },
  ]);
}

test("有效角色衍生解析为父锚点条目并确定性编译提示词（无 Text 调用）", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-resolve-role-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: WARDROBE_INSTRUCTION,
      source: "agent",
    });
    const { dependencies, textCalls } = derivedHarness(knex);

    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });

    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    const entry = resolved.value[0];
    assert.equal(entry.assetsId, 111);
    assert.equal(entry.briefType, "character");
    assert.deepEqual(entry.references, [], "衍生资产不持有任何人工参考图");
    assert.deepEqual(entry.selectedReferenceIds, []);
    assert.ok(entry.derived, "衍生条目必须携带父资产锚点信息");
    assert.equal(entry.derived.parentAssetId, 101);
    assert.equal(entry.derived.parentImageId, 501, "锚点必须取父资产当前选定的图像");
    assert.equal(entry.derived.anchorMediaPath, "/1/role/parent.png");
    assert.equal(entry.derived.changeInstructionRevision, 1);
    assert.ok(entry.generationPrompt.includes("服装由日常玄色外袍替换为祭天礼服"), "提示词必须包含声明的允许变化");
    assert.ok(entry.generationPrompt.includes("脸部拓扑"), "提示词必须包含锚点继承的 preserve 特征");
    assert.ok(entry.generationPrompt.includes("衍生视觉手册"), "提示词必须包含 art_*_derivative 视觉手册");
    assert.ok(entry.generationPrompt.includes("胡亥"), "提示词必须锚定父资产名称");
    assert.equal(entry.promptRevision.skillVersion, DERIVED_ANCHOR_SKILL_VERSION);

    const record = await knex("o_assetPromptRecord").where("assetsId", 111).first();
    assert.ok(record, "编译结果必须写入 o_assetPromptRecord");
    assert.equal(record.generationPrompt, entry.generationPrompt);
    assert.equal(record.skillVersion, DERIVED_ANCHOR_SKILL_VERSION);
    const assetRow = await knex("o_assets").where("id", 111).first();
    assert.equal(assetRow.prompt, entry.generationPrompt, "编译结果同步到资产最终提示词");

    assert.equal(textCalls.length, 0, "衍生解析阶段 Text Model 调用次数必须为 0");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("仅解析 Derived Asset 时不依赖基础 Asset 分析模板", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-no-base-template-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: WARDROBE_INSTRUCTION,
      source: "agent",
    });
    const { dependencies, textCalls } = derivedHarness(knex, { omitBaseAnalysisTemplate: true });

    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });

    assert.equal(resolved.ok, true, "Derived 确定性编译不得要求 batch_asset_analysis.md");
    assert.equal(textCalls.length, 0);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("有效场景时间衍生确定性编译", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-resolve-scene-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex, { derivedType: "scene", derivedDescribe: "黄昏时段的章台宫。" });
    await knex("o_assets").where("id", 101).update({ type: "scene" });
    await knex("o_image").where("id", 501).update({ type: "scene" });
    await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: {
        changeKind: "scene_time",
        evidence: ["第一幕：黄昏的章台宫。"],
        preserve: ["空间结构", "核心地标"],
        change: ["时段由白昼变为黄昏，整体光照与色调转为暖橙"],
        exclude: ["人物"],
      },
      source: "agent",
    });
    const { dependencies } = derivedHarness(knex);

    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });

    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.value[0].briefType, "scene");
    assert.ok(resolved.value[0].generationPrompt.includes("时段由白昼变为黄昏"));
    assert.ok(resolved.value[0].generationPrompt.includes("画面中不出现任何人物"), "场景衍生保留无人约束");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("衍生资产的人工参考图在外部提交前被稳定拒绝", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-ref-forbidden-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: WARDROBE_INSTRUCTION,
      source: "agent",
    });
    await knex("o_assetReference").insert({
      id: 1,
      projectId: 1,
      assetsId: 111,
      mediaPath: "/1/assetReferences/1.png",
      mediaMime: "image/png",
      orderIndex: 0,
      description: "人工描述",
      descriptionSource: "manual",
      analysisState: "not_requested",
      visualRole: "",
      requiredTransfers: "[]",
      exclusions: "[]",
      createTime: 1,
      updateTime: 1,
    });
    const { dependencies } = derivedHarness(knex);

    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.failure.kind, "derivedAssetReferenceForbidden");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("父资产缺失时稳定失败 parentAssetMissing", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-parent-missing-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    await knex("o_assets").where("id", 101).del();
    const { dependencies } = derivedHarness(knex);

    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.failure.kind, "parentAssetMissing");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("父资产未选定图像时稳定失败 parentAssetAnchorMissing", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-anchor-missing-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex, { parentImageId: null });
    await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: WARDROBE_INSTRUCTION,
      source: "agent",
    });
    const { dependencies } = derivedHarness(knex);

    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.failure.kind, "parentAssetAnchorMissing");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("父图行缺失或未完成时稳定失败 parentAssetAnchorMissing（不猜测历史图片）", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-anchor-row-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    await knex("o_image").where("id", 501).del();
    await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: WARDROBE_INSTRUCTION,
      source: "agent",
    });
    const { dependencies } = derivedHarness(knex);

    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.failure.kind, "parentAssetAnchorMissing");

    // 生成中的父图同样不构成接受的锚点
    await knex("o_image").insert({ id: 502, assetsId: 101, type: "role", state: "生成中", filePath: null });
    await knex("o_assets").where("id", 101).update({ imageId: 502 });
    const again = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.failure.kind, "parentAssetAnchorMissing");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("父资产不属于当前项目时稳定失败 parentAssetAnchorUnauthorized", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-anchor-foreign-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    await knex("o_assets").where("id", 101).update({ projectId: 2 });
    await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: WARDROBE_INSTRUCTION,
      source: "agent",
    });
    const { dependencies } = derivedHarness(knex);

    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.failure.kind, "parentAssetAnchorUnauthorized");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("变化契约缺失且 desc 为空时稳定失败 derivedChangeInstructionMissing", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-contract-missing-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex, { derivedDescribe: "   " });
    const { dependencies } = derivedHarness(knex);

    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.failure.kind, "derivedChangeInstructionMissing");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("项目缺少衍生视觉手册时确定性编译稳定失败 derivedPromptCompilationFailed", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-manual-missing-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    await knex("o_project").where("id", 1).update({ artStyle: "" });
    await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: WARDROBE_INSTRUCTION,
      source: "agent",
    });
    const { dependencies } = derivedHarness(knex);

    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.failure.kind, "derivedPromptCompilationFailed");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("持久化契约非法时稳定失败 derivedChangeInstructionInvalid（不文本降级）", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-contract-invalid-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    await knex("o_derivedChangeInstruction").insert({
      projectId: 1,
      assetsId: 111,
      source: "agent",
      revision: 3,
      instruction: "{not-json",
      createTime: 1,
      updateTime: 1,
    });
    const { dependencies } = derivedHarness(knex);

    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.failure.kind, "derivedChangeInstructionInvalid");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("旧非空 desc 确定性转换且不调用模型，转换结果可追溯 legacy_description", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-legacy-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex, { derivedDescribe: "换上祭天礼服 · 玄色广袖" });
    const { dependencies, textCalls } = derivedHarness(knex);

    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });

    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    const entry = resolved.value[0];
    assert.ok(entry.derived, "衍生条目必须携带父资产锚点信息");
    assert.equal(entry.derived.changeInstructionSource, "legacy_description", "来源必须标记为 legacy_description");
    assert.ok(entry.generationPrompt.includes("换上祭天礼服 · 玄色广袖"), "旧 desc 原文进入允许变化");
    assert.ok(entry.generationPrompt.includes("脸部拓扑"), "补充类型化 preserve 默认值");
    const instructionRow = await knex("o_derivedChangeInstruction").where("assetsId", 111).first();
    assert.ok(instructionRow, "确定性转换结果必须落库为契约记录");
    assert.equal(instructionRow.source, "legacy_description");
    assert.equal(textCalls.length, 0, "兼容转换不得调用模型猜测");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("现有 Derived Prop 通过 legacy_prop_state 保持生成兼容", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-legacy-prop-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex, { derivedType: "tool", derivedDescribe: "暴雨浸湿的名册，墨迹晕染。" });
    await knex("o_assets").where("id", 101).update({ type: "tool" });
    await knex("o_image").where("id", 501).update({ type: "tool" });
    const { dependencies } = derivedHarness(knex);

    const resolved = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });

    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    const entry = resolved.value[0];
    assert.equal(entry.briefType, "prop");
    assert.ok(entry.derived, "衍生条目必须携带父资产锚点信息");
    assert.equal(entry.derived.changeKind, "legacy_prop_state");
    assert.ok(entry.generationPrompt.includes("暴雨浸湿的名册"));
    assert.ok(entry.generationPrompt.includes("不出现人物、手部或持握关系"), "道具衍生保留纯道具约束");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("父图或契约变化后哈希失效并确定性重编译", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-recompile-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: WARDROBE_INSTRUCTION,
      source: "agent",
    });
    let manualContent = "衍生视觉手册：继承父资产基准外观，仅应用声明变化。";
    const { dependencies } = derivedHarness(knex, { manual: () => manualContent });

    const first = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const firstRecord = await knex("o_assetPromptRecord").where("assetsId", 111).first();

    // 输入未变化：复用记录，不重写
    await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    const unchanged = await knex("o_assetPromptRecord").where("assetsId", 111).first();
    assert.equal(unchanged.id, firstRecord.id, "新鲜记录必须原样复用");

    // 契约 revision 变化：重编译
    await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: { ...WARDROBE_INSTRUCTION, change: ["服装替换为玄色甲胄"] },
      source: "agent",
    });
    const second = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.ok(second.value[0] && second.value[0].derived, "衍生条目必须携带父资产锚点信息");
    assert.ok(second.value[0].generationPrompt.includes("玄色甲胄"), "契约变化必须触发重编译");
    const secondRecord = await knex("o_assetPromptRecord").where("assetsId", 111).first();
    assert.notEqual(secondRecord.contextHash, firstRecord.contextHash);
    assert.equal(second.value[0]!.derived!.changeInstructionRevision, 2);

    // 父图变化：重编译并锚定新图
    await knex("o_image").insert({ id: 502, assetsId: 101, type: "role", state: "已完成", filePath: "/1/role/parent2.png" });
    await knex("o_assets").where("id", 101).update({ imageId: 502 });
    const third = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    assert.equal(third.ok, true);
    if (!third.ok) return;
    assert.ok(third.value[0] && third.value[0].derived, "衍生条目必须携带父资产锚点信息");
    assert.equal(third.value[0].derived.parentImageId, 502, "锚点必须跟随父资产当前选定图像");
    const thirdRecord = await knex("o_assetPromptRecord").where("assetsId", 111).first();
    assert.notEqual(thirdRecord.referenceHash, secondRecord.referenceHash);

    // 视觉手册内容变化：contextHash 失效并确定性重编译
    manualContent = "衍生视觉手册（修订）：严格保持父资产面部与轮廓。";
    const forth = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    assert.equal(forth.ok, true);
    if (!forth.ok) return;
    assert.ok(forth.value[0]!.generationPrompt.includes("严格保持父资产面部与轮廓"), "手册变化必须进入重编译提示词");
    const forthRecord = await knex("o_assetPromptRecord").where("assetsId", 111).first();
    assert.notEqual(forthRecord.contextHash, thirdRecord.contextHash, "手册变化必须使 contextHash 失效");

    // 项目风格变化：同样确定性失效重编译
    await knex("o_project").where("id", 1).update({ artStyle: "anime_2d" });
    const fifth = await resolveAssetGenerationInputs(dependencies, { projectId: 1, assetsIds: [111] });
    assert.equal(fifth.ok, true);
    if (!fifth.ok) return;
    const fifthRecord = await knex("o_assetPromptRecord").where("assetsId", 111).first();
    assert.notEqual(fifthRecord.contextHash, forthRecord.contextHash, "项目风格变化必须使 contextHash 失效");
    const records = await knex("o_assetPromptRecord").where("assetsId", 111).select();
    assert.equal(records.length, 1, "重编译替换而不是追加记录");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// ─── Slice 3：图片生成阶段（fake Vendor，不调用真实供应商） ─────────────────

import {
  assetImageGenerationErrorEnvelope,
  generateAssetImage,
  prepareBatchAssetImages,
  type AssetImageGenerationDependencies,
} from "../src/assets/assetImageGeneration";
import type { ImageGenerationRequest } from "../src/vendor";

const MODEL = "agnes:agnes-image-2.1-flash";
const GENERATED_BASE64 = Buffer.from("derived-generated-bytes").toString("base64");
const ANCHOR_PATH = "/1/role/parent.png";

/** 受支持图片的字节（PNG magic + 可辨识负载），用于锚点媒体断言。 */
function pngBuffer(payload: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(payload, "utf8"),
  ]);
}

interface DerivedImageHarness {
  deps: AssetImageGenerationDependencies;
  vendorRequests: ImageGenerationRequest[];
  taskSnapshots: { describe: string; content: string }[];
  taskStates: { state: 1 | -1; reason?: string }[];
  storage: Map<string, string>;
  media: Map<string, Buffer>;
  textCalls: unknown[];
}

/** 衍生生成依赖：fake Vendor（无真实网络）、内存锚点媒体与存储、快照捕获；analyze 记录调用并抛错。 */
function derivedImageHarness(
  knex: Knex,
  options: { generateImage?: (request: ImageGenerationRequest) => Promise<string> } = {},
): DerivedImageHarness {
  const { dependencies, textCalls } = derivedHarness(knex);
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
  return { deps, vendorRequests, taskSnapshots, taskStates, storage, media, textCalls };
}

test("衍生资产图片生成提交恰好一个父资产锚点且快照脱敏（Text 调用为 0）", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-image-anchor-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: WARDROBE_INSTRUCTION,
      source: "agent",
    });
    const harness = derivedImageHarness(knex);
    harness.media.set(ANCHOR_PATH, pngBuffer("PARENT-ANCHOR"));

    const result = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 111,
      model: MODEL,
      resolution: "1K",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(harness.vendorRequests.length, 1);
    const input = harness.vendorRequests[0].input;
    assert.deepEqual(
      input.referenceList,
      [{ type: "image", base64: pngBuffer("PARENT-ANCHOR").toString("base64") }],
      "衍生资产必须恰好提交一个父资产锚点",
    );
    const record = await knex("o_assetPromptRecord").where("assetsId", 111).first();
    assert.equal(input.prompt, record.generationPrompt, "提交的提示词必须来自持久化提示词记录");

    assert.equal(harness.taskSnapshots.length, 1);
    const snapshotRaw = harness.taskSnapshots[0].content;
    const snapshot = JSON.parse(snapshotRaw);
    assert.deepEqual(
      snapshot.derived,
      {
        parentAssetId: 101,
        parentImageId: 501,
        changeKind: "character_wardrobe",
        changeInstructionRevision: 1,
        changeInstructionSource: "agent",
      },
      "快照必须记录脱敏的父资产锚点与契约版本",
    );
    assert.ok(snapshot.promptRevision.contextHash.length === 64, "快照必须携带 generationPrompt revision");
    assert.ok(!snapshotRaw.includes(pngBuffer("PARENT-ANCHOR").toString("base64")), "快照不得包含完整 base64 媒体");
    assert.ok(!snapshotRaw.includes("PARENT-ANCHOR"), "快照不得包含媒体内容负载");
    assert.ok(!snapshotRaw.includes(ANCHOR_PATH), "快照不得包含媒体存储路径");
    assert.ok(!snapshotRaw.includes("apiKey"), "快照不得包含凭证字段");
    assert.ok(harness.taskSnapshots[0].describe.includes("父资产锚点 1 张"));
    assert.deepEqual(harness.taskStates, [{ state: 1, reason: undefined }]);

    const image = await knex("o_image").where("assetsId", 111).first();
    assert.equal(image.state, "已完成");
    const asset = await knex("o_assets").where("id", 111).first();
    assert.equal(asset.imageId, image.id);
    assert.equal(harness.storage.get(image.filePath), GENERATED_BASE64);
    assert.equal(harness.textCalls.length, 0, "生成阶段 Text Model 调用次数必须为 0");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("批量衍生生成逐个提交父锚点并复用占位记录", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-image-batch-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    await knex("o_assets").insert({
      id: 112,
      name: "甲胄胡亥",
      type: "role",
      describe: "玄色甲胄版本。",
      assetsId: 101,
      projectId: 1,
    });
    for (const assetsId of [111, 112]) {
      await saveDerivedChangeInstruction(workOf(knex), {
        projectId: 1,
        assetsId,
        instruction: WARDROBE_INSTRUCTION,
        source: "agent",
      });
    }
    const harness = derivedImageHarness(knex);
    harness.media.set(ANCHOR_PATH, pngBuffer("PARENT-ANCHOR"));

    const prepared = await prepareBatchAssetImages(harness.deps, {
      projectId: 1,
      assetsIds: [111, 112],
      model: MODEL,
      resolution: "1K",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    for (const entry of prepared.value) {
      const result = await generateAssetImage(harness.deps, {
        projectId: 1,
        assetsId: entry.assetsId,
        model: MODEL,
        resolution: "1K",
        imageId: entry.imageId,
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.imageId, entry.imageId, "批量路径必须复用预置占位");
    }

    assert.equal(harness.vendorRequests.length, 2);
    const anchorBase64 = pngBuffer("PARENT-ANCHOR").toString("base64");
    for (const request of harness.vendorRequests) {
      assert.deepEqual(request.input.referenceList, [{ type: "image", base64: anchorBase64 }]);
    }
    const images = await knex("o_image").whereIn("assetsId", [111, 112]).select();
    assert.equal(images.length, 2, "只统计衍生资产的生成记录（父资产锚点图不计入）");
    assert.ok(images.every((row) => row.state === "已完成"));
    const snapshots = harness.taskSnapshots.map((snapshot) => JSON.parse(snapshot.content));
    assert.deepEqual(
      snapshots.map((snapshot: { id: number }) => snapshot.id),
      [111, 112],
    );
    assert.ok(snapshots.every((snapshot: { derived: { parentImageId: number } }) => snapshot.derived.parentImageId === 501));
    assert.equal(harness.textCalls.length, 0);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("父 Asset 与 Derived Asset 同批生成时冻结批次开始前的父资产锚点", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-parent-child-batch-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    const harness = derivedImageHarness(knex);
    harness.media.set(ANCHOR_PATH, pngBuffer("ACCEPTED-PARENT-ANCHOR"));
    let resolveCalls = 0;
    harness.deps.resolveGenerationInputs = async ({ assetsIds }) => {
      resolveCalls += 1;
      const parent = await knex("o_assets").where("id", 101).first();
      const parentImage = await knex("o_image").where("id", parent.imageId).first();
      const revision = {
        skillVersion: "test",
        templateHash: "template",
        contextHash: "context",
        referenceHash: "reference",
      };
      const entries = assetsIds.map((assetsId): ResolvedAssetGenerationInput => {
        if (assetsId === 101) {
          return {
            assetsId,
            assetRawType: "role",
            briefType: "character",
            name: "胡亥",
            generationPrompt: "父资产生成提示词",
            promptRevision: revision,
            references: [],
            selectedReferenceIds: [],
          };
        }
        return {
          assetsId,
          assetRawType: "role",
          briefType: "character",
          name: "祭服胡亥",
          generationPrompt: "衍生资产生成提示词",
          promptRevision: revision,
          references: [],
          selectedReferenceIds: [],
          derived: {
            parentAssetId: 101,
            parentImageId: parentImage.id,
            anchorMediaPath: parentImage.filePath,
            changeKind: "character_wardrobe",
            changeInstructionRevision: 1,
            changeInstructionSource: "agent",
          },
        };
      });
      return { ok: true, value: entries };
    };

    const prepared = await prepareBatchAssetImages(harness.deps, {
      projectId: 1,
      assetsIds: [101, 111],
      model: MODEL,
      resolution: "1K",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal(resolveCalls, 1, "批量预置前必须一次性解析并冻结所有生成输入");
    const child = prepared.value.find((entry) => entry.assetsId === 111)!;
    assert.equal(child.generationInput.derived?.parentImageId, 501, "子资产必须冻结批次开始前已接受的父图");
    assert.notEqual((await knex("o_assets").where("id", 101).first()).imageId, 501, "父资产随后可绑定本批占位");

    const generated = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 111,
      model: MODEL,
      resolution: "1K",
      imageId: child.imageId,
      generationInput: child.generationInput,
    });
    assert.equal(generated.ok, true);
    assert.equal(resolveCalls, 1, "生成阶段不得在父 imageId 被占位覆盖后重新解析锚点");
    assert.deepEqual(harness.vendorRequests[0].input.referenceList, [
      { type: "image", base64: pngBuffer("ACCEPTED-PARENT-ANCHOR").toString("base64") },
    ]);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("父锚点媒体缺失或非法时在外部提交前稳定失败", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-image-unreadable-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: WARDROBE_INSTRUCTION,
      source: "agent",
    });
    const harness = derivedImageHarness(knex);

    const missing = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 111,
      model: MODEL,
      resolution: "1K",
    });
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.equal(missing.failure.kind, "parentAssetAnchorUnreadable");
    assert.equal(harness.vendorRequests.length, 0, "必须在外部提交前失败");
    assert.equal(harness.taskSnapshots.length, 0);
    assert.equal((await knex("o_image").where("assetsId", 111).select()).length, 0, "单个路径在锚点校验失败时不创建占位记录");
    const envelope = assetImageGenerationErrorEnvelope(missing.failure);
    assert.equal(envelope.status, 500);
    assert.equal(envelope.body.error, "parentAssetAnchorUnreadable");

    // 媒体存在但内容不是受支持的图片：同样稳定失败
    harness.media.set(ANCHOR_PATH, Buffer.from("not-an-image"));
    const invalid = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 111,
      model: MODEL,
      resolution: "1K",
    });
    assert.equal(invalid.ok, false);
    if (invalid.ok) return;
    assert.equal(invalid.failure.kind, "parentAssetAnchorUnreadable");
    assert.equal(harness.vendorRequests.length, 0);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("衍生生成失败可重试且复用稳定输入，快照记录失败信息", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-image-retry-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: WARDROBE_INSTRUCTION,
      source: "agent",
    });
    let calls = 0;
    const harness = derivedImageHarness(knex, {
      generateImage: async () => {
        calls += 1;
        if (calls === 1) throw new Error("vendor down");
        return GENERATED_BASE64;
      },
    });
    harness.media.set(ANCHOR_PATH, pngBuffer("PARENT-ANCHOR"));

    const first = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 111,
      model: MODEL,
      resolution: "1K",
    });
    assert.equal(first.ok, false);
    if (first.ok) return;
    assert.equal(first.failure.kind, "imageGenerationFailed");
    const failedRow = await knex("o_image").where("assetsId", 111).first();
    assert.equal(failedRow.state, "生成失败");
    assert.ok(String(failedRow.errorReason).includes("vendor down"), "失败原因必须回写占位记录供诊断");
    assert.deepEqual(
      harness.taskStates[0],
      { state: -1, reason: "vendor down" },
      "任务快照必须记录失败状态与原因",
    );
    const firstSnapshot = JSON.parse(harness.taskSnapshots[0].content);
    assert.equal(firstSnapshot.attempt, 1);
    assert.equal(firstSnapshot.retryEvidence, null);

    const second = await generateAssetImage(harness.deps, {
      projectId: 1,
      assetsId: 111,
      model: MODEL,
      resolution: "1K",
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(harness.vendorRequests.length, 2);
    assert.deepEqual(harness.vendorRequests[0].input, harness.vendorRequests[1].input, "重试必须提交完全相同的稳定输入");
    const secondSnapshot = JSON.parse(harness.taskSnapshots[1].content);
    assert.equal(secondSnapshot.attempt, 2, "快照必须记录重试序号");
    assert.equal(secondSnapshot.retryEvidence.retryOfImageId, failedRow.id, "快照必须关联上一失败图片记录");
    assert.match(secondSnapshot.retryEvidence.failureReasonHash, /^[a-f0-9]{64}$/u, "失败证据只记录脱敏指纹");
    assert.ok(!harness.taskSnapshots[1].content.includes("vendor down"), "快照不得记录原始供应商错误文本");
    const { attempt: firstAttempt, retryEvidence: firstRetry, ...firstStable } = firstSnapshot;
    const { attempt: secondAttempt, retryEvidence: secondRetry, ...secondStable } = secondSnapshot;
    assert.deepEqual(firstStable, secondStable, "重试必须保留稳定生成命令，只改变尝试证据");
    const promptRecords = await knex("o_assetPromptRecord").where("assetsId", 111).select();
    assert.equal(promptRecords.length, 1, "重试复用同一条提示词记录");
    const images = await knex("o_image").where("assetsId", 111).select();
    assert.equal(images.length, 2, "重试生成新的 o_image 记录");
    assert.equal(second.value.imageId, images.find((row) => row.state === "已完成")!.id);
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Production Agent 批量路由是薄适配器（静态迁移守卫）", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "routes", "production", "assets", "batchGenerateAssetsImage.ts"),
    "utf8",
  );
  assert.ok(!source.includes("u.Ai.Text"), "路由不得调用 u.Ai.Text");
  assert.ok(!source.includes('from "@/utils/ai"'), "路由不得加载旧 ai 模块");
  assert.ok(!source.includes('from "@/utils/vendor"'), "路由不得加载旧 vendor 模块");
  assert.ok(!source.includes('from "@/vendor"'), "路由不得直接接触 configured Vendor");
  assert.ok(!source.includes("getDefaultConfiguredVendor"), "路由不得直接调用 Vendor");
  assert.ok(!source.includes("invokeText"), "路由不得直接调用 Text Model");
  assert.ok(!source.includes("applyLegacyImageReferenceConversion"), "路由不得做旧供应商参考图翻译");
  assert.ok(!source.includes("oss.getFile"), "路由不得手工加载父图 Base64");
  assert.ok(!source.includes("Buffer.from"), "路由不得手工解码媒体字节");
  assert.ok(!source.includes('toString("base64")'), "路由不得手工编码 Base64");
  assert.ok(!source.includes("generationPrompt"), "路由不得拼接提示词");
  assert.ok(source.includes('from "@/assets/assetImageGeneration"'), "路由必须委托领域模块");
});

// ─── Slice 4：Production Agent 批量路由（注入依赖的行为级测试） ────────────────

import express from "express";
import { once } from "node:events";
import { createBatchGenerateAssetsImageRouter } from "../src/routes/production/assets/batchGenerateAssetsImage";

async function withDerivedTestServer(router: express.Router, handler: (url: string) => Promise<void>): Promise<void> {
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

async function waitForDerivedImages(knex: Knex, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await knex("o_image").where("assetsId", 111).select();
    if (rows.length === count && rows.every((row) => row.state !== "生成中")) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等待衍生图片状态回写超时");
}

test("Production Agent 批量路由注入依赖完成衍生生成并稳定返回项目错误", async () => {
  const { directory, knex } = createTemporaryDatabase("toonflow-derived-route-");
  try {
    await prepareSchema(knex);
    await seedDerivedSetup(knex);
    await knex("o_project").where("id", 1).update({ imageModel: MODEL, imageQuality: "1K" });
    await saveDerivedChangeInstruction(workOf(knex), {
      projectId: 1,
      assetsId: 111,
      instruction: WARDROBE_INSTRUCTION,
      source: "agent",
    });
    const harness = derivedImageHarness(knex);
    harness.media.set(ANCHOR_PATH, pngBuffer("PARENT-ANCHOR"));

    await withDerivedTestServer(createBatchGenerateAssetsImageRouter(() => harness.deps), async (url) => {
      const response = await fetch(url + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: [111], projectId: 1, scriptId: 1 }),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { code: number; data: string };
      assert.equal(body.code, 200);
    });

    await waitForDerivedImages(knex, 1);
    assert.equal(harness.vendorRequests.length, 1, "路由必须经领域模块提交 fake Vendor");
    assert.deepEqual(
      harness.vendorRequests[0].input.referenceList,
      [{ type: "image", base64: pngBuffer("PARENT-ANCHOR").toString("base64") }],
      "路由路径必须提交恰好一个父资产锚点",
    );
    assert.equal(harness.textCalls.length, 0, "路由路径 Text Model 调用次数必须为 0");

    // 项目图片模型未配置：稳定错误信封，不进入生成
    await knex("o_project").where("id", 1).update({ imageModel: null });
    await withDerivedTestServer(createBatchGenerateAssetsImageRouter(() => harness.deps), async (url) => {
      const response = await fetch(url + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: [111], projectId: 1 }),
      });
      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string };
      assert.equal(body.error, "invalidRequest");
    });
    assert.equal(harness.vendorRequests.length, 1, "错误路径不得追加 Vendor 调用");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
