import { z } from "zod";

import type { AssetReferenceRecord } from "./assetReferences";

/**
 * Asset Brief 契约（Issue #33）。
 *
 * 本模块是 data/skills/asset-prompting/references/asset-brief.schema.json 的
 * 运行时镜像：zod Schema 同时用于 Text Model 结构化输出约束与持久化前校验。
 * 语义校验（每个输入 Asset ID 恰好一次、类型与衍生身份与数据库一致、参考
 * 绑定与人工契约一致）在结构校验之后执行，人工描述/标签被篡改时做有限修复。
 */

export type AssetBriefType = "character" | "scene" | "prop";

export type AssetPromptFailureKind =
  | "invalidRequest"
  | "projectNotFound"
  | "assetNotFound"
  | "assetProjectMismatch"
  | "unsupportedAssetType"
  | "scriptNotFound"
  | "visualManualMissing"
  | "skillContractMissing"
  | "malformedOutput"
  | "missingAssetResult"
  | "duplicateAssetResult"
  | "unknownAssetResult"
  | "assetTypeMismatch"
  | "derivedMismatch"
  | "referenceBindingMismatch"
  | "analysisFailed"
  | "languageProfileNotAvailable"
  | "promptNotGenerated"
  | "stalePromptRecord"
  | "referenceLimitExceeded"
  | "derivedAssetReferenceForbidden"
  | "parentAssetMissing"
  | "parentAssetAnchorMissing"
  | "parentAssetAnchorUnauthorized"
  | "parentAssetAnchorUnreadable"
  | "derivedChangeInstructionMissing"
  | "derivedChangeInstructionInvalid"
  | "derivedPromptCompilationFailed";

export interface AssetPromptFailure {
  kind: AssetPromptFailureKind;
  message: string;
}

export type AssetPromptResult<T> = { ok: true; value: T } | { ok: false; failure: AssetPromptFailure };

export function assetPromptFailure(kind: AssetPromptFailureKind, message: string): AssetPromptFailure {
  return { kind, message };
}

const nonEmptyString = z.string().min(1);
const stringList = z.array(nonEmptyString);
const nullableId = z.number().int().min(1).nullable();

const evidenceSchema = z
  .object({
    source: z.enum(["reference", "script", "asset", "parent", "inference", "style-default"]),
    fact: nonEmptyString,
    locator: nonEmptyString,
    confidence: z.enum(["explicit", "strong-inference", "bounded-inference", "fallback"]),
  })
  .strict();

const differenceAnchorSchema = z
  .object({
    dimension: nonEmptyString,
    value: nonEmptyString,
    reason: nonEmptyString,
  })
  .strict();

const siblingContrastSchema = z
  .object({
    assetId: z.number().int().min(1),
    dimensions: stringList,
    instruction: nonEmptyString,
  })
  .strict();

export const ASSET_BRIEF_PRIMARY_ROLES = [
  "identity",
  "structure",
  "material",
  "color",
  "style",
  "composition",
  "state",
] as const;

export const assetReferenceBindingSchema = z
  .object({
    referenceId: nonEmptyString,
    label: nonEmptyString,
    description: nonEmptyString,
    primaryRole: z.enum(ASSET_BRIEF_PRIMARY_ROLES),
    subjectSelector: z.string().nullable(),
    mustPreserve: stringList,
    mustIgnore: stringList,
    controlledDimensions: stringList,
    priority: z.number().int().min(1).max(6),
    evidenceSource: z.literal("manual"),
  })
  .strict();

export type AssetReferenceBinding = z.infer<typeof assetReferenceBindingSchema>;

const generationRequirementsSchema = z
  .object({
    outputFormat: nonEmptyString,
    composition: nonEmptyString,
    background: nonEmptyString,
    requiredElements: stringList,
    prohibitedElements: stringList,
    aspectRatio: z.string().nullable(),
  })
  .strict();

const briefCommonShape = {
  assetId: z.number().int().min(1),
  isDerived: z.boolean(),
  parentAssetId: nullableId,
  name: nonEmptyString,
  narrativeFunction: nonEmptyString,
  eraRegion: nonEmptyString,
  evidence: z.array(evidenceSchema).min(1),
  immutable: stringList,
  flexible: stringList,
  storyChanging: stringList,
  differenceAnchors: z.array(differenceAnchorSchema).min(2),
  forbiddenDefaults: stringList,
  contrastAgainstSiblingAssets: z.array(siblingContrastSchema),
  referenceBindings: z.array(assetReferenceBindingSchema).max(6),
  generationRequirements: generationRequirementsSchema,
};

const characterDesignSchema = z
  .object({
    identitySummary: nonEmptyString,
    socialRole: nonEmptyString,
    profession: nonEmptyString,
    agePresentation: nonEmptyString,
    personalityContradiction: nonEmptyString,
    silhouette: nonEmptyString,
    faceTopology: nonEmptyString,
    hairStructure: nonEmptyString,
    bodyPosture: nonEmptyString,
    wardrobeStructure: nonEmptyString,
    materialsCraft: nonEmptyString,
    wearHistory: nonEmptyString,
    signatureMarks: stringList,
    negativeIdentity: stringList,
  })
  .strict();

const sceneDesignSchema = z
  .object({
    spatialStructure: nonEmptyString,
    actionPlane: nonEmptyString,
    accessPattern: nonEmptyString,
    landmark: nonEmptyString,
    scale: nonEmptyString,
    architecture: nonEmptyString,
    materialsCraft: nonEmptyString,
    maintenanceState: nonEmptyString,
    useTraces: nonEmptyString,
    timeWeatherState: nonEmptyString,
    negativeIdentity: stringList,
  })
  .strict();

const propDesignSchema = z
  .object({
    propClass: z.enum(["hero", "action", "evidence", "texture"]),
    owner: nonEmptyString,
    geometry: nonEmptyString,
    relativeScale: nonEmptyString,
    operation: nonEmptyString,
    materialsCraft: nonEmptyString,
    wearRepairHistory: nonEmptyString,
    distinctiveMarks: stringList,
    continuity: nonEmptyString,
    negativeIdentity: stringList,
  })
  .strict();

const characterBriefSchema = z
  .object({ ...briefCommonShape, assetType: z.literal("character"), design: characterDesignSchema })
  .strict();

const sceneBriefSchema = z
  .object({ ...briefCommonShape, assetType: z.literal("scene"), design: sceneDesignSchema })
  .strict();

const propBriefSchema = z
  .object({ ...briefCommonShape, assetType: z.literal("prop"), design: propDesignSchema })
  .strict();

export const assetBriefSchema = z.discriminatedUnion("assetType", [
  characterBriefSchema,
  sceneBriefSchema,
  propBriefSchema,
]);

export type AssetBrief = z.infer<typeof assetBriefSchema>;
export type CharacterBrief = z.infer<typeof characterBriefSchema>;
export type SceneBrief = z.infer<typeof sceneBriefSchema>;
export type PropBrief = z.infer<typeof propBriefSchema>;

const worldBibleSchema = z
  .object({
    eraRegion: stringList,
    socialOrder: stringList,
    materialCulture: stringList,
    shapeLanguage: stringList,
    paletteLogic: stringList,
    sharedProhibitions: stringList,
  })
  .strict();

const contrastEntrySchema = z
  .object({
    dimension: nonEmptyString,
    assignments: z
      .array(
        z
          .object({
            assetId: z.number().int().min(1),
            value: nonEmptyString,
          })
          .strict(),
      )
      .min(1),
    collisionAssetIds: z.array(z.number().int().min(1)),
    resolution: z.string(),
  })
  .strict();

export const assetBriefBatchSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    language: z.literal("zh-CN"),
    worldBible: worldBibleSchema,
    contrastMatrix: z.array(contrastEntrySchema),
    assetBriefs: z.array(assetBriefSchema).min(1),
  })
  .strict();

export type AssetBriefBatch = z.infer<typeof assetBriefBatchSchema>;

/**
 * 数据库 o_assets.type 与前端历史别名到 Asset Brief 类型的规范映射。
 * 修复旧链路 props/tool/role 路由漂移：所有别名统一收敛到三种 Brief 类型。
 */
const ASSET_TYPE_ALIASES: Record<string, AssetBriefType> = {
  role: "character",
  character: "character",
  characters: "character",
  scene: "scene",
  scenes: "scene",
  tool: "prop",
  prop: "prop",
  props: "prop",
};

export function canonicalAssetBriefType(rawType: string | null | undefined): AssetBriefType | null {
  if (!rawType) return null;
  return ASSET_TYPE_ALIASES[rawType.trim().toLowerCase()] ?? null;
}

/**
 * 解析模型输出：结构化调用通常直接返回对象；兼容字符串输出（剥离 Markdown
 * 围栏、截取最外层 JSON 对象）。这是允许的全部"有限修复"入口之一。
 */
export function parseAnalysisOutput(raw: unknown): AssetPromptResult<unknown> {
  if (raw !== null && typeof raw === "object") return { ok: true, value: raw };
  if (typeof raw !== "string") {
    return { ok: false, failure: assetPromptFailure("malformedOutput", "模型输出为空或不是对象") };
  }
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { ok: false, failure: assetPromptFailure("malformedOutput", "模型输出中不包含 JSON 对象") };
  }
  try {
    return { ok: true, value: JSON.parse(text.slice(start, end + 1)) };
  } catch {
    return { ok: false, failure: assetPromptFailure("malformedOutput", "模型输出不是合法 JSON") };
  }
}

/** 持久化参考图在分析输入中的呈现：referenceId 稳定为 `ref-<id>`。 */
export function referenceBindingId(referenceId: number): string {
  return `ref-${referenceId}`;
}

export function presentedReferenceLabel(reference: AssetReferenceRecord): string {
  return reference.visualRole?.trim() ? reference.visualRole.trim() : `参考图${reference.orderIndex + 1}`;
}

export interface ExpectedAssetInput {
  assetsId: number;
  briefType: AssetBriefType;
  isDerived: boolean;
  parentAssetId: number | null;
  references: readonly AssetReferenceRecord[];
}

export type ReferenceRepairKind = "descriptionRestored" | "labelRestored" | "unknownReferenceDropped";

export interface ReferenceRepairNote {
  assetsId: number;
  referenceId: string;
  kind: ReferenceRepairKind;
}

export interface ValidatedAssetBriefBatch {
  batch: AssetBriefBatch;
  repairs: ReferenceRepairNote[];
}

export function parseReferenceRowId(referenceId: string): number | null {
  const match = referenceId.match(/^(?:ref-)?(\d+)$/);
  return match ? Number(match[1]) : null;
}

/**
 * 语义校验 + 有限修复。
 *
 * - 每个输入 Asset ID 必须恰好出现一次（缺失/重复/未知均拒绝）；
 * - assetType 必须与数据库规范类型一致；isDerived/parentAssetId 必须与
 *   数据库父资产事实一致；
 * - 参考绑定必须一一对应人工参考图：描述与标签被篡改时恢复为持久化原文
 *   （人工契约最高优先级），未知 referenceId 的绑定被丢弃；人工参考图
 *   存在而绑定缺失、或无参考图而凭空出现绑定时整体拒绝。
 */
export function validateAssetBriefBatch(
  batchValue: unknown,
  expected: readonly ExpectedAssetInput[],
): AssetPromptResult<ValidatedAssetBriefBatch> {
  const parsed = assetBriefBatchSchema.safeParse(batchValue);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const location = issue?.path?.length ? `（${issue.path.join(".")}）` : "";
    return {
      ok: false,
      failure: assetPromptFailure("malformedOutput", `模型输出不符合 Asset Brief Schema${location}: ${issue?.message ?? "结构错误"}`),
    };
  }

  const batch = parsed.data;
  const expectedById = new Map(expected.map((item) => [item.assetsId, item]));
  const repairs: ReferenceRepairNote[] = [];

  const seen = new Set<number>();
  for (const brief of batch.assetBriefs) {
    if (seen.has(brief.assetId)) {
      return {
        ok: false,
        failure: assetPromptFailure("duplicateAssetResult", `模型对资产 ${brief.assetId} 返回了重复的 Brief`),
      };
    }
    seen.add(brief.assetId);
  }
  const unknownIds = [...seen].filter((id) => !expectedById.has(id));
  if (unknownIds.length > 0) {
    return {
      ok: false,
      failure: assetPromptFailure("unknownAssetResult", `模型返回了未知资产: ${unknownIds.join(", ")}`),
    };
  }
  const missing = expected.filter((item) => !seen.has(item.assetsId)).map((item) => item.assetsId);
  if (missing.length > 0) {
    return {
      ok: false,
      failure: assetPromptFailure("missingAssetResult", `模型缺失了资产结果: ${missing.join(", ")}`),
    };
  }

  const repairedBriefs: AssetBrief[] = [];
  for (const brief of batch.assetBriefs) {
    const target = expectedById.get(brief.assetId)!;
    if (brief.assetType !== target.briefType) {
      return {
        ok: false,
        failure: assetPromptFailure(
          "assetTypeMismatch",
          `资产 ${brief.assetId} 的类型应为 ${target.briefType}，模型返回 ${brief.assetType}`,
        ),
      };
    }
    if (brief.isDerived !== target.isDerived || brief.parentAssetId !== target.parentAssetId) {
      return {
        ok: false,
        failure: assetPromptFailure(
          "derivedMismatch",
          `资产 ${brief.assetId} 的衍生身份与数据库不一致（期望 isDerived=${target.isDerived}, parentAssetId=${target.parentAssetId}）`,
        ),
      };
    }

    const referencesById = new Map(target.references.map((ref) => [ref.id, ref]));
    if (target.references.length === 0 && brief.referenceBindings.length > 0) {
      return {
        ok: false,
        failure: assetPromptFailure("referenceBindingMismatch", `资产 ${brief.assetId} 没有人工参考图，模型凭空返回了参考绑定`),
      };
    }

    const bindings: AssetReferenceBinding[] = [];
    const boundRowIds = new Set<number>();
    for (const binding of brief.referenceBindings) {
      const rowId = parseReferenceRowId(binding.referenceId);
      const reference = rowId === null ? undefined : referencesById.get(rowId);
      if (!reference) {
        repairs.push({ assetsId: brief.assetId, referenceId: binding.referenceId, kind: "unknownReferenceDropped" });
        continue;
      }
      if (boundRowIds.has(reference.id)) {
        return {
          ok: false,
          failure: assetPromptFailure(
            "referenceBindingMismatch",
            `资产 ${brief.assetId} 的参考图 ${referenceBindingId(reference.id)} 被重复绑定`,
          ),
        };
      }
      boundRowIds.add(reference.id);
      const restored = { ...binding, referenceId: referenceBindingId(reference.id) };
      if (restored.description !== reference.description) {
        repairs.push({ assetsId: brief.assetId, referenceId: binding.referenceId, kind: "descriptionRestored" });
        restored.description = reference.description;
      }
      const presentedLabel = presentedReferenceLabel(reference);
      if (restored.label !== presentedLabel) {
        repairs.push({ assetsId: brief.assetId, referenceId: binding.referenceId, kind: "labelRestored" });
        restored.label = presentedLabel;
      }
      bindings.push(restored);
    }

    // 参考绑定必须与人工参考图一一对应：任何一张已知参考图缺少绑定都会丢失人工契约
    const missingReference = target.references.find((reference) => !boundRowIds.has(reference.id));
    if (missingReference) {
      return {
        ok: false,
        failure: assetPromptFailure(
          "referenceBindingMismatch",
          `资产 ${brief.assetId} 的人工参考图 ${referenceBindingId(missingReference.id)} 缺少对应绑定`,
        ),
      };
    }

    repairedBriefs.push({ ...brief, referenceBindings: bindings });
  }

  return { ok: true, value: { batch: { ...batch, assetBriefs: repairedBriefs }, repairs } };
}
