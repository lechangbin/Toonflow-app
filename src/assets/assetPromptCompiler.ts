import {
  assetPromptFailure,
  type AssetBrief,
  type AssetPromptResult,
  type AssetReferenceBinding,
  type CharacterBrief,
  type PropBrief,
  type SceneBrief,
} from "./assetBriefContract";

/**
 * Asset prompt 编译器（Issue #33）。
 *
 * 依据 data/skills/asset-prompting/prompts/compile_{character,scene,prop}_asset.md
 * 的排序规则（先身份，后物理证据，再差异/负面身份，然后参考契约、额外要求、
 * 画面格式与美术风格前缀）与 reference_contract.md 的权威契约格式，把已校验
 * 的 Asset Brief 确定性地编译为最终中文 generationPrompt。编译过程不调用
 * Text Model——一次批量分析调用是唯一的模型调用。
 *
 * Language profile 以注册表形式接入：当前仅启用 zh-CN，en 为接口预留，
 * 请求未注册的 profile 会得到结构化失败而不是中英文混杂输出。
 */

export type LanguageProfile = "zh-CN" | "en";

export interface AssetPromptModelProfile {
  referenceMode: "none" | "single" | "multi";
  maxReferences: number;
  languageProfile: LanguageProfile;
}

/** 当前按 Agnes Image 2.1 Flash 的参考图上限验证与展示（0–6 张，multi 模式）。 */
export const AGNES_IMAGE_2_1_FLASH_PROFILE: AssetPromptModelProfile = {
  referenceMode: "multi",
  maxReferences: 6,
  languageProfile: "zh-CN",
};

export interface CompileAssetPromptInput {
  brief: AssetBrief;
  /** Derived Asset 的父资产身份；非衍生资产为 null/undefined。 */
  parentAsset?: { id: number; name: string } | null;
  /** 项目美术风格前缀（prefix.md 内容），可为空。 */
  artStylePrefix?: string | null;
  modelProfile: AssetPromptModelProfile;
  /** 用户额外要求（otherTextPrompt），只能补充未冲突维度。 */
  additionalRequirements?: string | null;
}

export interface CompiledAssetPrompt {
  generationPrompt: string;
  referenceClause: string;
  selectedBindings: AssetReferenceBinding[];
}

interface ReferenceSelection {
  clause: string;
  selected: AssetReferenceBinding[];
}

/**
 * reference_contract.md 规则 1/2/6 的确定性实现：
 * - 同一 controlledDimension 只保留一个最终控制来源（优先级最小者胜出，
 *   平局时受控维度更多者、再按原始顺序稳定）；
 * - 不依据上传顺序授予权威；
 * - 失去全部受控维度的参考图不进入本次生成；
 * - 超出 Model Profile 上限时按优先级与受控维度覆盖度稳定截断；
 * - single 模式仅保留一张，none 模式不产生任何参考措辞。
 */
function selectReferences(bindings: readonly AssetReferenceBinding[], profile: AssetPromptModelProfile): ReferenceSelection {
  if (profile.referenceMode === "none" || bindings.length === 0) {
    return { clause: "", selected: [] };
  }

  const candidates = bindings.map((original, index) => ({ original, index }));
  const winnerByDimension = new Map<string, { index: number; priority: number; coverage: number }>();
  for (const candidate of candidates) {
    for (const dimension of candidate.original.controlledDimensions) {
      const incumbent = winnerByDimension.get(dimension);
      const challenger = {
        index: candidate.index,
        priority: candidate.original.priority,
        coverage: candidate.original.controlledDimensions.length,
      };
      if (
        !incumbent ||
        challenger.priority < incumbent.priority ||
        (challenger.priority === incumbent.priority && challenger.coverage > incumbent.coverage)
      ) {
        winnerByDimension.set(dimension, challenger);
      }
    }
  }

  const survived = candidates
    .map((candidate) => {
      const controlledDimensions = candidate.original.controlledDimensions.filter(
        (dimension) => winnerByDimension.get(dimension)?.index === candidate.index,
      );
      return { ...candidate.original, controlledDimensions };
    })
    .filter((bindingItem) => bindingItem.controlledDimensions.length > 0);

  const limit = profile.referenceMode === "single" ? 1 : Math.max(0, profile.maxReferences);
  const selected = survived
    .map((original, index) => ({ original, index }))
    .sort((a, b) => {
      if (a.original.priority !== b.original.priority) return a.original.priority - b.original.priority;
      if (b.original.controlledDimensions.length !== a.original.controlledDimensions.length) {
        return b.original.controlledDimensions.length - a.original.controlledDimensions.length;
      }
      return a.index - b.index;
    })
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.original);

  const clause = selected.map(renderReferenceClause).join("");
  return { clause, selected };
}

/** reference_contract.md 规定的约束片段格式，人工标签与描述逐字进入。 */
function renderReferenceClause(binding: AssetReferenceBinding): string {
  const subject = binding.subjectSelector?.trim() ? binding.subjectSelector : "整图指定主体";
  return (
    `${binding.label}（人工描述：${binding.description}；职责：${binding.primaryRole}；主体：${subject}）：` +
    `必须继承${binding.mustPreserve.join("、")}；仅控制${binding.controlledDimensions.join("、")}；` +
    `必须忽略${binding.mustIgnore.join("、")}。`
  );
}

function joinList(values: readonly string[], separator = "、"): string {
  return values.filter((value) => value && value.trim().length > 0).join(separator);
}

function renderNegativeIdentity(negativeIdentity: readonly string[], forbiddenDefaults: readonly string[]): string {
  const parts: string[] = [];
  if (negativeIdentity.length > 0) parts.push(joinList(negativeIdentity, "，"));
  if (forbiddenDefaults.length > 0) parts.push(`不使用${joinList(forbiddenDefaults)}`);
  return parts.length > 0 ? `${parts.join("，")}。` : "";
}

function renderDifferenceAnchors(brief: AssetBrief): string {
  if (brief.differenceAnchors.length === 0) return "";
  const anchors = brief.differenceAnchors.map((anchor) => `${anchor.dimension}——${anchor.value}（${anchor.reason}）`);
  return `差异锚点：${anchors.join("；")}。`;
}

function renderSiblingContrast(brief: AssetBrief): string {
  if (brief.contrastAgainstSiblingAssets.length === 0) return "";
  const contrasts = brief.contrastAgainstSiblingAssets.map((contrast) => contrast.instruction);
  return `同类资产对比：${contrasts.join("；")}。`;
}

function renderDerivedState(brief: AssetBrief, parentAsset: CompileAssetPromptInput["parentAsset"]): string {
  if (!brief.isDerived || !parentAsset) return "";
  const sentences: string[] = [];
  if (brief.immutable.length > 0) {
    sentences.push(`基于父资产${parentAsset.name}的衍生状态，保持${joinList(brief.immutable)}不变`);
  } else {
    sentences.push(`基于父资产${parentAsset.name}的衍生状态`);
  }
  if (brief.storyChanging.length > 0) {
    sentences.push(`仅应用剧情状态变化：${joinList(brief.storyChanging)}`);
  }
  return `${sentences.join("，")}，不重做核心造型。`;
}

function renderStoryChanging(brief: AssetBrief): string {
  if (brief.isDerived || brief.storyChanging.length === 0) return "";
  return `剧情可变状态：${joinList(brief.storyChanging)}。`;
}

function renderGenerationRequirements(brief: AssetBrief): string {
  const requirements = brief.generationRequirements;
  const parts: string[] = [requirements.outputFormat, requirements.composition];
  const required = joinList(requirements.requiredElements);
  if (required) parts.push(required);
  parts.push(requirements.background);
  const prohibited = joinList(requirements.prohibitedElements);
  const tail = prohibited ? `，无${joinList(requirements.prohibitedElements, "、无")}` : "";
  return `${parts.join("，")}${tail}。`;
}

function renderArtStylePrefix(prefix: string | null | undefined): string {
  const trimmed = (prefix ?? "").trim();
  if (!trimmed) return "";
  return trimmed.endsWith("。") ? trimmed : `${trimmed}。`;
}

function renderAdditionalRequirements(requirements: string | null | undefined): string {
  const trimmed = (requirements ?? "").trim();
  return trimmed ? `额外要求：${trimmed}。` : "";
}

function assembleBody(
  brief: AssetBrief,
  identity: string,
  physical: string,
  input: CompileAssetPromptInput,
  referenceClause: string,
  typeInvariant = "",
): string {
  const segments: string[] = [identity, physical];
  const anchors = renderDifferenceAnchors(brief);
  if (anchors) segments.push(anchors);
  const sibling = renderSiblingContrast(brief);
  if (sibling) segments.push(sibling);
  const negative = renderNegativeIdentity(
    (brief.design as { negativeIdentity?: string[] }).negativeIdentity ?? [],
    brief.forbiddenDefaults,
  );
  if (negative) segments.push(negative);
  if (typeInvariant) segments.push(typeInvariant);
  const derived = renderDerivedState(brief, input.parentAsset);
  if (derived) segments.push(derived);
  const story = renderStoryChanging(brief);
  if (story) segments.push(story);
  if (referenceClause) segments.push(referenceClause);
  const additional = renderAdditionalRequirements(input.additionalRequirements);
  if (additional) segments.push(additional);
  segments.push(renderGenerationRequirements(brief));
  const prefix = renderArtStylePrefix(input.artStylePrefix);
  if (prefix) segments.push(prefix);
  return segments.filter((segment) => segment.length > 0).join("");
}

function renderCharacterBrief(brief: CharacterBrief, input: CompileAssetPromptInput, referenceClause: string): string {
  const design = brief.design;
  const identity =
    `${brief.name}，${brief.eraRegion}的${design.identitySummary}。社会身份${design.socialRole}，` +
    `职业${design.profession}，年龄呈现${design.agePresentation}，承担${brief.narrativeFunction}，` +
    `性格矛盾：${design.personalityContradiction}。`;
  const physicalParts = [
    `轮廓${design.silhouette}`,
    `脸部拓扑${design.faceTopology}`,
    `发型${design.hairStructure}`,
    `体态${design.bodyPosture}`,
    `服装层级${design.wardrobeStructure}`,
    `材料工艺${design.materialsCraft}`,
    `磨损历史${design.wearHistory}`,
  ];
  const signature = joinList(design.signatureMarks);
  if (signature) physicalParts.push(`标志性细节：${signature}`);
  return assembleBody(brief, identity, `${physicalParts.join("；")}。`, input, referenceClause);
}

function renderSceneBrief(brief: SceneBrief, input: CompileAssetPromptInput, referenceClause: string): string {
  const design = brief.design;
  const identity = `${brief.name}，${brief.eraRegion}中${brief.narrativeFunction}的空间。`;
  const physicalParts = [
    `空间结构${design.spatialStructure}`,
    `行动平面${design.actionPlane}`,
    `出入与动线${design.accessPattern}`,
    `核心地标${design.landmark}`,
    `尺度${design.scale}`,
    `建造方式${design.architecture}`,
    `材料工艺${design.materialsCraft}`,
    `维护状态${design.maintenanceState}`,
    `使用痕迹${design.useTraces}`,
    `时段与天气${design.timeWeatherState}`,
  ];
  // 无人约束是场景的确定性要求，不依赖模型返回的 prohibitedElements
  return assembleBody(
    brief,
    identity,
    `${physicalParts.join("；")}。`,
    input,
    referenceClause,
    "场景为纯空间设定，画面中不出现任何人物。",
  );
}

function renderPropBrief(brief: PropBrief, input: CompileAssetPromptInput, referenceClause: string): string {
  const design = brief.design;
  const identity = `${brief.name}，${design.propClass} prop，${brief.narrativeFunction}，所有者：${design.owner}。`;
  const physicalParts = [
    `几何轮廓${design.geometry}`,
    `相对尺度${design.relativeScale}`,
    `操作结构${design.operation}`,
    `材料工艺${design.materialsCraft}`,
    `磨损与维修${design.wearRepairHistory}`,
    `辨识标记：${joinList(design.distinctiveMarks)}`,
    `连续性：${design.continuity}`,
  ];
  // 纯道具、无人、无手、无人持有是道具的确定性要求，不依赖模型返回的 prohibitedElements
  return assembleBody(
    brief,
    identity,
    `${physicalParts.join("；")}。`,
    input,
    referenceClause,
    "纯道具展示，画面中不出现人物、手部或持握关系。",
  );
}

function renderZhAssetPrompt(brief: AssetBrief, input: CompileAssetPromptInput, referenceClause: string): string {
  switch (brief.assetType) {
    case "character":
      return renderCharacterBrief(brief, input, referenceClause);
    case "scene":
      return renderSceneBrief(brief, input, referenceClause);
    case "prop":
      return renderPropBrief(brief, input, referenceClause);
  }
}

type LanguageRenderer = (brief: AssetBrief, input: CompileAssetPromptInput, referenceClause: string) => string;

/** 语言 profile 注册表。en 为未来英文 profile 预留：注册前请求会结构化失败。 */
const LANGUAGE_RENDERERS: Partial<Record<LanguageProfile, LanguageRenderer>> = {
  "zh-CN": renderZhAssetPrompt,
};

export function compileAssetGenerationPrompt(input: CompileAssetPromptInput): AssetPromptResult<CompiledAssetPrompt> {
  const renderer = LANGUAGE_RENDERERS[input.modelProfile.languageProfile];
  if (!renderer) {
    return {
      ok: false,
      failure: assetPromptFailure(
        "languageProfileNotAvailable",
        `语言 profile ${input.modelProfile.languageProfile} 尚未启用，当前仅支持 zh-CN`,
      ),
    };
  }
  const selection = selectReferences(input.brief.referenceBindings, input.modelProfile);
  const generationPrompt = renderer(input.brief, input, selection.clause);
  return {
    ok: true,
    value: {
      generationPrompt,
      referenceClause: selection.clause,
      selectedBindings: selection.selected,
    },
  };
}
