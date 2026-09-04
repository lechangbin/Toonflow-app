import {
  assetPromptFailure,
  type AssetBriefType,
  type AssetPromptResult,
} from "./assetBriefContract";
import { AGNES_IMAGE_2_1_FLASH_PROFILE } from "./assetPromptCompiler";
import {
  areDimensionsCompatibleWithBriefType,
  legacyInstructionFromDescription,
  loadDerivedChangeInstruction,
  saveDerivedChangeInstruction,
  visualStateDimensionBriefType,
  type DerivedChangeInstruction,
  type DerivedChangeInstructionSource,
  type VisualStateDimension,
} from "./derivedChangeInstruction";
import type { AssetReferenceRecord } from "./assetReferences";
import type { AssetPromptOrchestrationDependencies } from "./assetPromptOrchestration";
import { sha256 } from "./contentHash";

/**
 * Derived Asset 提示词确定性编译（Issue #37 / #42，ADR-0007）。
 *
 * 编译输入只有四类，全部确定性可得，不调用 Text Model：
 *   父资产锚点继承规则 + Derived Change Instruction（可组合 dimensions[]）
 *   + art_*_derivative 视觉手册 + 输出格式与禁止项。
 *
 * 失效契约：父图（o_assets.imageId 指向的已接受图像）、变化契约 revision、
 * 衍生视觉手册内容或项目风格（前缀/手册）任一变化都会改变 contextHash/
 * referenceHash，触发确定性重编译并替换 o_assetPromptRecord。
 */

export const DERIVED_ANCHOR_SKILL_VERSION = "asset-prompting-derived@1.0";

const DERIVED_PROMPT_COMPILER_VERSION = "derived-prompt-compiler@2.0";

const VISUAL_STATE_DIMENSION_LABELS: Record<VisualStateDimension, string> = {
  age_stage: "年龄阶段",
  wardrobe: "服装变化",
  grooming: "妆造变化",
  morphology: "形态变化",
  surface_condition: "表面状态",
  effect: "特效状态",
  status_presentation: "身份地位呈现",
  time_of_day: "时段状态",
  weather: "天气状态",
  season: "季节状态",
  atmosphere: "氛围状态",
  practical_lighting: "实际灯光",
  persistent_condition: "持续环境状态",
  condition: "状态变化",
  configuration: "配置状态",
  activation: "激活状态",
  contents: "内容物状态",
};

/** 类型化输出格式与禁止项（与基础编译器的确定性要求一致）。 */
const OUTPUT_RULES_BY_TYPE: Record<AssetBriefType, string> = {
  character: "输出为单角色定妆设定图，构图完整呈现变化后的整体外观，画面中不出现其他角色。",
  scene: "输出为场景主视图，场景为纯空间设定，画面中不出现任何人物。",
  prop: "输出为纯道具静物设定图，画面中不出现人物、手部或持握关系。",
};

export interface CompileDerivedAssetPromptInput {
  assetName: string;
  parentAsset: { id: number; name: string };
  instruction: DerivedChangeInstruction;
  manualKey: string;
  manualContent: string | null;
  artStylePrefix: string | null;
}

function joinList(values: readonly string[], separator = "、"): string {
  return values.filter((value) => value && value.trim().length > 0).join(separator);
}

/** 父资产锚点继承规则 + Derived Change Instruction + 视觉手册 + 输出格式/禁止项。 */
export function compileDerivedAssetPrompt(input: CompileDerivedAssetPromptInput): AssetPromptResult<{ generationPrompt: string }> {
  if (input.instruction.preserve.length === 0 || input.instruction.change.length === 0) {
    return {
      ok: false,
      failure: assetPromptFailure("derivedPromptCompilationFailed", "变化契约缺少 preserve 或 change 条目，无法编译"),
    };
  }
  const manual = input.manualContent?.trim();
  if (!manual) {
    return {
      ok: false,
      failure: assetPromptFailure("derivedPromptCompilationFailed", `衍生视觉手册 ${input.manualKey} 内容为空，无法编译`),
    };
  }

  const segments: string[] = [];
  const dimensionLabels = input.instruction.dimensions.map((dimension) => VISUAL_STATE_DIMENSION_LABELS[dimension]);
  // 输出格式按维度所属类型推导；维度跨类型混合时无法确定性选择输出规则，稳定失败
  const dimensionBriefTypes = new Set(input.instruction.dimensions.map(visualStateDimensionBriefType));
  if (dimensionBriefTypes.size !== 1) {
    return {
      ok: false,
      failure: assetPromptFailure(
        "derivedPromptCompilationFailed",
        `变化契约的视觉状态维度 [${input.instruction.dimensions.join(", ")}] 跨资产类型混合，无法编译`,
      ),
    };
  }
  const briefType = [...dimensionBriefTypes][0]!;
  segments.push(
    `${input.assetName}是父资产「${input.parentAsset.name}」的衍生视觉状态（视觉状态维度：${joinList(dimensionLabels)}），` +
      `以本次请求随图提交的父资产锚点图（父资产当前接受的图像）为唯一视觉基准。`,
  );
  segments.push(
    `父资产锚点继承规则：必须完整继承${joinList(input.instruction.preserve)}等父资产既有特征；` +
      `除下列声明的允许变化外，不得对父资产外观做任何其他修改。`,
  );
  segments.push(`本次仅允许发生以下变化：${joinList(input.instruction.change, "；")}。`);
  if (input.instruction.exclude.length > 0) {
    segments.push(`禁止出现：${joinList(input.instruction.exclude)}。`);
  }
  if (input.instruction.evidence.length > 0) {
    segments.push(`变化依据（剧本证据）：${joinList(input.instruction.evidence, "；")}。`);
  }
  segments.push(`${input.manualKey} 视觉手册：${manual}`);
  segments.push(`${OUTPUT_RULES_BY_TYPE[briefType]}画面不包含文字、水印或边框。`);
  const prefix = input.artStylePrefix?.trim();
  if (prefix) {
    segments.push(prefix.endsWith("。") ? prefix : `${prefix}。`);
  }
  return { ok: true, value: { generationPrompt: segments.join("") } };
}

export interface DerivedParentAnchor {
  parentAssetId: number;
  parentImageId: number;
  anchorMediaPath: string;
  dimensions: VisualStateDimension[];
  changeInstructionRevision: number;
  changeInstructionSource: DerivedChangeInstructionSource;
}

export interface ResolvedDerivedAssetPrompt {
  assetsId: number;
  assetRawType: string;
  briefType: AssetBriefType;
  name: string;
  generationPrompt: string;
  promptRevision: {
    skillVersion: string;
    templateHash: string;
    contextHash: string;
    referenceHash: string;
  };
  references: AssetReferenceRecord[];
  selectedReferenceIds: number[];
  derived: DerivedParentAnchor;
}

export interface ResolveDerivedAssetPromptInput {
  projectId: number;
  asset: {
    id: number;
    name: string | null;
    type: string | null;
    describe: string | null;
    assetsId: number;
    briefType: AssetBriefType;
  };
  parent: {
    id: number;
    name: string | null;
    describe: string | null;
    imageId: number | null;
    projectId: number;
    assetsId: number | null;
    briefType: AssetBriefType;
  } | null;
  references: readonly AssetReferenceRecord[];
  artStyle: string | null;
  manualContent: string | null;
  artStylePrefix: string | null;
}

function isReusableDerivedRecord(
  record: Record<string, unknown> | undefined,
  expectation: { templateHash: string; contextHash: string; referenceHash: string; modelProfileJson: string },
): boolean {
  if (!record) return false;
  return (
    record.skillVersion === DERIVED_ANCHOR_SKILL_VERSION &&
    record.templateHash === expectation.templateHash &&
    record.contextHash === expectation.contextHash &&
    record.referenceHash === expectation.referenceHash &&
    record.modelProfile === expectation.modelProfileJson &&
    typeof record.generationPrompt === "string" &&
    record.generationPrompt.length > 0
  );
}

/**
 * 解析单个 Derived Asset 的生成输入：校验人工参考图禁令、父资产与锚点、
 * 变化契约（含旧 desc 兼容转换），然后做新鲜度判定——命中则复用
 * o_assetPromptRecord，否则确定性重编译并替换记录。全程不调用 Text Model。
 */
export async function resolveDerivedAssetGenerationEntry(
  dependencies: AssetPromptOrchestrationDependencies,
  input: ResolveDerivedAssetPromptInput,
): Promise<AssetPromptResult<ResolvedDerivedAssetPrompt>> {
  const { projectId, asset } = input;

  if (input.references.length > 0) {
    return {
      ok: false,
      failure: assetPromptFailure(
        "derivedAssetReferenceForbidden",
        `衍生资产 ${asset.id} 不支持人工参考图，生成只继承父资产锚点`,
      ),
    };
  }

  const parent = input.parent;
  if (!parent) {
    return { ok: false, failure: assetPromptFailure("parentAssetMissing", `衍生资产 ${asset.id} 的父资产不存在`) };
  }
  if (parent.assetsId != null) {
    return {
      ok: false,
      failure: assetPromptFailure("parentAssetMissing", `衍生资产 ${asset.id} 的父资产 ${parent.id} 本身是衍生资产，父关系异常`),
    };
  }
  if (parent.projectId !== projectId) {
    return {
      ok: false,
      failure: assetPromptFailure("parentAssetAnchorUnauthorized", `衍生资产 ${asset.id} 的父资产 ${parent.id} 不属于当前项目`),
    };
  }
  if (parent.briefType !== asset.briefType) {
    return {
      ok: false,
      failure: assetPromptFailure(
        "derivedChangeInstructionInvalid",
        `衍生资产 ${asset.id} 的类型 ${asset.briefType} 与父资产 ${parent.id} 的类型 ${parent.briefType} 不一致，请重新分析`,
      ),
    };
  }
  if (parent.imageId == null) {
    return {
      ok: false,
      failure: assetPromptFailure("parentAssetAnchorMissing", `父资产 ${parent.id} 当前没有选定的图像，缺少 Parent Asset Anchor`),
    };
  }
  const parentImage = await dependencies.work((db) => db("o_image").where("id", parent.imageId!).first());
  if (!parentImage || parentImage.assetsId !== parent.id || parentImage.state !== "已完成" || !parentImage.filePath) {
    return {
      ok: false,
      failure: assetPromptFailure(
        "parentAssetAnchorMissing",
        `父资产 ${parent.id} 选定的图像 ${parent.imageId} 不是已完成的可用锚点`,
      ),
    };
  }

  // 变化契约：优先读取持久化记录；无记录时走旧 desc 确定性转换；两者皆无则要求重新分析
  const loaded = await loadDerivedChangeInstruction(dependencies.work, { projectId, assetsId: asset.id });
  if (!loaded.ok) return { ok: false, failure: loaded };
  let instructionRecord = loaded.value;
  if (!instructionRecord) {
    const converted = legacyInstructionFromDescription({ describe: asset.describe, briefType: asset.briefType });
    if (!converted) {
      return {
        ok: false,
        failure: assetPromptFailure(
          "derivedChangeInstructionMissing",
          `衍生资产 ${asset.id} 缺少变化契约且旧描述为空，请重新执行衍生分析`,
        ),
      };
    }
    const saved = await saveDerivedChangeInstruction(dependencies.work, {
      projectId,
      assetsId: asset.id,
      instruction: converted,
      source: "legacy_description",
      now: dependencies.now,
    });
    if (!saved.ok) return { ok: false, failure: saved };
    instructionRecord = saved.value;
  }
  if (
    !areDimensionsCompatibleWithBriefType(instructionRecord.instruction.dimensions, asset.briefType)
  ) {
    return {
      ok: false,
      failure: assetPromptFailure(
        "derivedChangeInstructionInvalid",
        `衍生资产 ${asset.id} 的视觉状态维度 [${instructionRecord.instruction.dimensions.join(", ")}] 与资产类型 ${asset.briefType} 不一致，请重新分析`,
      ),
    };
  }

  const manualKey = `art_${asset.briefType}_derivative`;
  const templateHash = sha256(DERIVED_PROMPT_COMPILER_VERSION);
  const modelProfileJson = JSON.stringify(AGNES_IMAGE_2_1_FLASH_PROFILE);
  const contextHash = sha256(
    JSON.stringify({
      parent: { id: parent.id, name: parent.name, imageId: parent.imageId },
      instruction: {
        revision: instructionRecord.revision,
        source: instructionRecord.source,
        dimensions: instructionRecord.instruction.dimensions,
        evidence: instructionRecord.instruction.evidence,
        preserve: instructionRecord.instruction.preserve,
        change: instructionRecord.instruction.change,
        exclude: instructionRecord.instruction.exclude,
        legacyDescribe: instructionRecord.source === "legacy_description" ? asset.describe : null,
      },
      manual: { key: manualKey, content: input.manualContent },
      artStyle: input.artStyle,
      artStylePrefix: input.artStylePrefix,
      asset: { id: asset.id, name: asset.name },
    }),
  );
  const referenceHash = sha256(JSON.stringify({ parentAssetId: parent.id, parentImageId: parent.imageId }));

  const existing = await dependencies.work((db) => db("o_assetPromptRecord").where("assetsId", asset.id).first());
  const reusable = isReusableDerivedRecord(existing, { templateHash, contextHash, referenceHash, modelProfileJson });
  let generationPrompt: string;
  if (reusable) {
    generationPrompt = existing!.generationPrompt as string;
  } else {
    const compile = compileDerivedAssetPrompt({
      assetName: asset.name ?? "",
      parentAsset: { id: parent.id, name: parent.name ?? "" },
      instruction: instructionRecord.instruction,
      manualKey,
      manualContent: input.manualContent,
      artStylePrefix: input.artStylePrefix,
    });
    if (!compile.ok) return compile;
    generationPrompt = compile.value.generationPrompt;

    const now = dependencies.now();
    await dependencies.work((db) =>
      db.transaction(async (tx) => {
        await tx("o_assetPromptRecord").where("assetsId", asset.id).delete();
        await tx("o_assetPromptRecord").insert({
          projectId,
          assetsId: asset.id,
          scriptId: null,
          skillVersion: DERIVED_ANCHOR_SKILL_VERSION,
          language: "zh-CN",
          templateHash,
          contextHash,
          referenceHash,
          modelProfile: modelProfileJson,
          assetBrief: JSON.stringify(instructionRecord!.instruction),
          batchContext: JSON.stringify({
            derivedChangeSource: instructionRecord!.source,
            changeInstructionRevision: instructionRecord!.revision,
          }),
          generationPrompt,
          validationState: "validated",
          repairNotes: null,
          additionalRequirements: null,
          createTime: now,
          updateTime: now,
        });
        await tx("o_assets").where("id", asset.id).update({
          prompt: generationPrompt,
          promptState: "已完成",
          promptErrorReason: null,
        });
      }),
    );
  }

  return {
    ok: true,
    value: {
      assetsId: asset.id,
      assetRawType: asset.type ?? "",
      briefType: asset.briefType,
      name: asset.name ?? "",
      generationPrompt,
      promptRevision: { skillVersion: DERIVED_ANCHOR_SKILL_VERSION, templateHash, contextHash, referenceHash },
      references: [],
      selectedReferenceIds: [],
      derived: {
        parentAssetId: parent.id,
        parentImageId: parent.imageId!,
        anchorMediaPath: parentImage.filePath,
        dimensions: instructionRecord.instruction.dimensions,
        changeInstructionRevision: instructionRecord.revision,
        changeInstructionSource: instructionRecord.source,
      },
    },
  };
}
