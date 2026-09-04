import type { Knex } from "knex";
import { z } from "zod";

import type { DatabaseWork } from "@/database";

import type { AssetBriefType } from "./assetBriefContract";

/**
 * Derived Change Instruction 领域契约（Issue #37 / #42，ADR-0007）。
 *
 * Production Agent 在衍生分析阶段写入的结构化、带版本的变化契约：声明
 * 可组合的视觉状态维度 dimensions[]、剧本证据、必须从父资产继承的
 * preserve、允许发生的 change 与禁止出现的 exclude。name/desc 只是展示
 * 字段，不构成可执行契约；图片生成阶段用本契约与 Parent Asset Anchor
 * 确定性编译最终提示词，不调用 Text Model。
 *
 * 兼容策略（Issue #42）：旧单一 changeKind 记录只读兼容——读取时按
 * LEGACY_CHANGE_KIND_DIMENSIONS 确定性映射为单元素 dimensions[]，不调用
 * 模型、不落库；旧记录在下一次正常更新时写回新版 dimensions[] 格式。
 * 新写入只接受新版 dimensions[]。旧衍生资产没有契约记录时，非空 desc 走
 * 确定性 legacy_description 转换（类型映射维度 + 类型化 preserve/exclude
 * 默认值 + desc 原文作为唯一允许变化），空 desc 或父关系异常时要求重新
 * 衍生分析。
 */

/**
 * Visual State Dimension：按资产类型分组的可组合视觉状态维度。
 * 镜头级概念（camera、shot_scale、framing、frame_position、pose、
 * action_phase、expression、gaze、eyeline）不属于枚举，天然被拒绝。
 */
export const CHARACTER_VISUAL_STATE_DIMENSIONS = [
  "age_stage",
  "wardrobe",
  "grooming",
  "morphology",
  "surface_condition",
  "effect",
  "status_presentation",
] as const;

export const SCENE_VISUAL_STATE_DIMENSIONS = [
  "time_of_day",
  "weather",
  "season",
  "atmosphere",
  "practical_lighting",
  "persistent_condition",
] as const;

export const PROP_VISUAL_STATE_DIMENSIONS = ["condition", "configuration", "activation", "contents"] as const;

export const VISUAL_STATE_DIMENSIONS = [
  ...CHARACTER_VISUAL_STATE_DIMENSIONS,
  ...SCENE_VISUAL_STATE_DIMENSIONS,
  ...PROP_VISUAL_STATE_DIMENSIONS,
] as const;

export type VisualStateDimension = (typeof VISUAL_STATE_DIMENSIONS)[number];

const VISUAL_STATE_DIMENSIONS_BY_BRIEF_TYPE: Record<AssetBriefType, readonly VisualStateDimension[]> = {
  character: CHARACTER_VISUAL_STATE_DIMENSIONS,
  scene: SCENE_VISUAL_STATE_DIMENSIONS,
  prop: PROP_VISUAL_STATE_DIMENSIONS,
};

/** dimensions[] 与资产规范类型的一致性校验（确定性，不依赖模型）。 */
function isVisualStateDimensionCompatibleWithBriefType(
  dimension: VisualStateDimension,
  briefType: AssetBriefType,
): boolean {
  return VISUAL_STATE_DIMENSIONS_BY_BRIEF_TYPE[briefType].includes(dimension);
}

/** 非空且全部维度与资产类型一致时才兼容。 */
export function areDimensionsCompatibleWithBriefType(
  dimensions: readonly VisualStateDimension[],
  briefType: AssetBriefType,
): boolean {
  return dimensions.length > 0 && dimensions.every((dimension) => isVisualStateDimensionCompatibleWithBriefType(dimension, briefType));
}

/** 维度 → 规范类型的正向映射（维度按类型互斥，消除重复 switch）。 */
export function visualStateDimensionBriefType(dimension: VisualStateDimension): AssetBriefType {
  const briefType = (Object.keys(VISUAL_STATE_DIMENSIONS_BY_BRIEF_TYPE) as AssetBriefType[]).find((briefType) =>
    VISUAL_STATE_DIMENSIONS_BY_BRIEF_TYPE[briefType].includes(dimension),
  );
  return briefType ?? "character";
}

/** 旧单一变化类型：仅用于存量记录的只读兼容与确定性映射。 */
export const DERIVED_CHANGE_KINDS = [
  "character_wardrobe",
  "character_effect",
  "character_morphology",
  "scene_time",
  "legacy_prop_state",
] as const;

export type DerivedChangeKind = (typeof DERIVED_CHANGE_KINDS)[number];

/** 旧 changeKind → 新单元素 dimensions[] 的确定性映射表。 */
export const LEGACY_CHANGE_KIND_DIMENSIONS: Record<DerivedChangeKind, VisualStateDimension> = {
  character_wardrobe: "wardrobe",
  character_effect: "effect",
  character_morphology: "morphology",
  scene_time: "time_of_day",
  legacy_prop_state: "condition",
};

/** 契约来源：agent = 衍生分析写入；legacy_description = 旧 desc 确定性转换。 */
export const DERIVED_CHANGE_INSTRUCTION_SOURCES = ["agent", "legacy_description"] as const;

export type DerivedChangeInstructionSource = (typeof DERIVED_CHANGE_INSTRUCTION_SOURCES)[number];

const evidenceSchema = z.array(z.string().min(1));
const preserveSchema = z.array(z.string().min(1)).min(1);
const changeSchema = z.array(z.string().min(1)).min(1);
const excludeSchema = z.array(z.string().min(1));

/** 新版契约：可组合 dimensions[]（至少一个、不得重复），新写入只接受本格式。 */
export const derivedChangeInstructionSchema = z
  .object({
    dimensions: z
      .array(z.enum(VISUAL_STATE_DIMENSIONS))
      .min(1)
      .refine((dimensions) => new Set(dimensions).size === dimensions.length, { message: "dimensions 不得重复" }),
    evidence: evidenceSchema,
    preserve: preserveSchema,
    change: changeSchema,
    exclude: excludeSchema,
  })
  .strict();

export type DerivedChangeInstruction = z.infer<typeof derivedChangeInstructionSchema>;

/** 旧版契约：单一 changeKind，仅用于存量记录读取兼容。 */
const legacyDerivedChangeInstructionSchema = z
  .object({
    changeKind: z.enum(DERIVED_CHANGE_KINDS),
    evidence: evidenceSchema,
    preserve: preserveSchema,
    change: changeSchema,
    exclude: excludeSchema,
  })
  .strict();

/**
 * 确定性兼容解析：新版原样通过；旧版按 LEGACY_CHANGE_KIND_DIMENSIONS
 * 映射为单元素 dimensions[]（其余字段原样保留）；两者皆非法时返回 null。
 * 全程不调用 Text Model。
 */
export function normalizeDerivedChangeInstruction(raw: unknown): DerivedChangeInstruction | null {
  const next = derivedChangeInstructionSchema.safeParse(raw);
  if (next.success) return next.data;
  const legacy = legacyDerivedChangeInstructionSchema.safeParse(raw);
  if (!legacy.success) return null;
  const { changeKind, ...rest } = legacy.data;
  return { ...rest, dimensions: [LEGACY_CHANGE_KIND_DIMENSIONS[changeKind]] };
}

/** 旧 desc → 维度的确定性类型映射。 */
const LEGACY_DIMENSIONS_BY_BRIEF_TYPE: Record<AssetBriefType, readonly VisualStateDimension[]> = {
  character: ["wardrobe"],
  scene: ["time_of_day"],
  prop: ["condition"],
};

/** 类型化 preserve 默认值：旧记录无契约内容时的确定性继承清单。 */
const LEGACY_PRESERVE_BY_BRIEF_TYPE: Record<AssetBriefType, readonly string[]> = {
  character: ["脸部拓扑", "体型轮廓", "发型结构", "标志性细节"],
  scene: ["空间结构", "核心地标", "建造方式", "材料工艺", "尺度"],
  prop: ["几何轮廓", "材料工艺", "辨识标记"],
};

/** 类型化 exclude 默认值。 */
const LEGACY_EXCLUDE_BY_BRIEF_TYPE: Record<AssetBriefType, readonly string[]> = {
  character: ["背景变化", "文字", "水印", "额外角色"],
  scene: ["人物", "文字", "水印"],
  prop: ["人物", "手部", "持握关系", "文字", "水印"],
};

/**
 * 旧 desc 的确定性兼容转换：非空 desc 作为唯一允许变化，维度与
 * preserve/exclude 按类型取默认值；不调用模型、不虚构证据。空 desc 返回
 * null —— 该记录必须重新衍生分析。
 */
export function legacyInstructionFromDescription(input: {
  describe: string | null | undefined;
  briefType: AssetBriefType;
}): DerivedChangeInstruction | null {
  const describe = input.describe?.trim();
  if (!describe) return null;
  return {
    dimensions: [...LEGACY_DIMENSIONS_BY_BRIEF_TYPE[input.briefType]],
    evidence: [],
    preserve: [...LEGACY_PRESERVE_BY_BRIEF_TYPE[input.briefType]],
    change: [describe],
    exclude: [...LEGACY_EXCLUDE_BY_BRIEF_TYPE[input.briefType]],
  };
}

export interface DerivedChangeInstructionRecord {
  id: number;
  projectId: number;
  assetsId: number;
  source: DerivedChangeInstructionSource;
  revision: number;
  instruction: DerivedChangeInstruction;
  createTime: number;
  updateTime: number;
}

export type DerivedChangeInstructionResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "derivedChangeInstructionInvalid"; message: string };

function toRecord(row: {
  id: number;
  projectId: number | null;
  assetsId: number;
  source: string | null;
  revision: number | null;
  instruction: string | null;
  createTime: number | null;
  updateTime: number | null;
}): DerivedChangeInstructionResult<DerivedChangeInstructionRecord> {
  const instruction = normalizeDerivedChangeInstruction(safeParseJson(row.instruction));
  const source = row.source;
  if (
    !Number.isInteger(row.id) ||
    row.id <= 0 ||
    typeof row.projectId !== "number" ||
    !Number.isInteger(row.projectId) ||
    row.projectId <= 0 ||
    !Number.isInteger(row.assetsId) ||
    row.assetsId <= 0 ||
    (source !== "agent" && source !== "legacy_description") ||
    typeof row.revision !== "number" ||
    !Number.isInteger(row.revision) ||
    row.revision < 1 ||
    typeof row.createTime !== "number" ||
    !Number.isInteger(row.createTime) ||
    row.createTime < 0 ||
    typeof row.updateTime !== "number" ||
    !Number.isInteger(row.updateTime) ||
    row.updateTime < 0
  ) {
    return { ok: false, kind: "derivedChangeInstructionInvalid", message: "持久化的变化契约缺少合法的来源、版本或归属信息" };
  }
  if (!instruction) {
    return {
      ok: false,
      kind: "derivedChangeInstructionInvalid",
      message: "持久化的变化契约不是合法 JSON 或不符合 Schema（新旧格式均不匹配）",
    };
  }
  return {
    ok: true,
    value: {
      id: row.id,
      projectId: row.projectId,
      assetsId: row.assetsId,
      source,
      revision: row.revision,
      instruction,
      createTime: row.createTime,
      updateTime: row.updateTime,
    },
  };
}

function safeParseJson(raw: string | null): unknown {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface SaveDerivedChangeInstructionInput {
  projectId: number;
  assetsId: number;
  instruction: unknown;
  source: DerivedChangeInstructionSource;
  /** 可选：校验 dimensions 与资产规范类型一致（衍生分析工具按父资产类型传入）。 */
  expectedBriefType?: AssetBriefType;
  now?: () => number;
}

/**
 * 写入或更新衍生资产的变化契约：同一资产 upsert，revision 在已有记录上
 * 递增，保证父图/契约变化后的失效判定与诊断都有单调版本可依。新写入只
 * 接受新版 dimensions[] 格式；旧 changeKind 记录在更新时即写回新版格式。
 */
export async function saveDerivedChangeInstruction(
  work: DatabaseWork,
  input: SaveDerivedChangeInstructionInput,
): Promise<DerivedChangeInstructionResult<DerivedChangeInstructionRecord>> {
  const parsed = derivedChangeInstructionSchema.safeParse(input.instruction);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const isLegacyChangeKind =
      typeof input.instruction === "object" &&
      input.instruction !== null &&
      "changeKind" in input.instruction;
    return {
      ok: false,
      kind: "derivedChangeInstructionInvalid",
      message: isLegacyChangeKind
        ? `新写入只允许新版 dimensions[] 格式（${issue?.path?.join(".") ?? ""}）: ${issue?.message ?? "结构错误"}`
        : `变化契约不符合 Schema（${issue?.path?.join(".") ?? ""}）: ${issue?.message ?? "结构错误"}`,
    };
  }
  const instruction = parsed.data;
  if (input.expectedBriefType && !areDimensionsCompatibleWithBriefType(instruction.dimensions, input.expectedBriefType)) {
    return {
      ok: false,
      kind: "derivedChangeInstructionInvalid",
      message: `视觉状态维度 [${instruction.dimensions.join(", ")}] 与资产类型 ${input.expectedBriefType} 不一致`,
    };
  }
  const now = (input.now ?? Date.now)();
  const saved = await work(async (db) =>
    db.transaction(async (tx) => {
      const existing = await tx("o_derivedChangeInstruction")
        .where({ assetsId: input.assetsId, projectId: input.projectId })
        .first();
      if (existing) {
        const parsedExisting = toRecord(existing);
        if (!parsedExisting.ok) return parsedExisting;
        const revision = parsedExisting.value.revision + 1;
        await tx("o_derivedChangeInstruction").where("id", existing.id).update({
          source: input.source,
          revision,
          instruction: JSON.stringify(instruction),
          updateTime: now,
        });
        return {
          ok: true as const,
          value: {
            ...parsedExisting.value,
            source: input.source,
            revision,
            instruction,
            updateTime: now,
          },
        };
      }
      const [id] = await tx("o_derivedChangeInstruction").insert({
        projectId: input.projectId,
        assetsId: input.assetsId,
        source: input.source,
        revision: 1,
        instruction: JSON.stringify(instruction),
        createTime: now,
        updateTime: now,
      });
      return {
        ok: true as const,
        value: {
          id,
          projectId: input.projectId,
          assetsId: input.assetsId,
          source: input.source,
          revision: 1,
          instruction,
          createTime: now,
          updateTime: now,
        },
      };
    }),
  );
  return saved;
}

/**
 * 读取变化契约。value 为 null 表示该资产尚无契约记录；持久化行存在但内容
 * 非法时返回 derivedChangeInstructionInvalid，调用方不得回退到纯文本。旧
 * changeKind 记录在读取时确定性转换为单元素 dimensions[]，不写回数据库。
 */
export async function loadDerivedChangeInstruction(
  work: DatabaseWork,
  input: { projectId: number; assetsId: number },
): Promise<DerivedChangeInstructionResult<DerivedChangeInstructionRecord | null>> {
  const row = await work((db) =>
    db("o_derivedChangeInstruction").where({ assetsId: input.assetsId, projectId: input.projectId }).first(),
  );
  if (!row) return { ok: true, value: null };
  const parsed = toRecord(row);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

/**
 * 等价状态复用判定：同一父资产下，dimensions 组合（顺序无关）且 change
 * 变化声明（顺序无关、逐字一致）都相同的既有衍生资产视为等价状态组合，
 * 返回其 ID 供调用方要求复用；无等价时返回 null。同一维度下不同状态值
 * （如黄昏与清晨）是不同状态，不构成等价。契约缺失或非法的兄弟记录不
 * 阻塞写入（其自身生成链路会稳定失败）；自由文本改写的等价无法确定性
 * 判定，由 Skill 复用规则约束。
 */
export async function findEquivalentDerivedAsset(
  work: DatabaseWork,
  input: {
    projectId: number;
    parentAssetsId: number;
    dimensions: readonly VisualStateDimension[];
    change: readonly string[];
    /** 更新场景排除自身，避免自比较。 */
    excludeAssetsId?: number;
  },
): Promise<number | null> {
  const siblings = await work((db) =>
    db("o_assets").where({ assetsId: input.parentAssetsId, projectId: input.projectId }).select("id"),
  );
  const siblingIds = siblings.map((sibling: { id: number }) => sibling.id).filter((id: number) => id !== input.excludeAssetsId);
  if (siblingIds.length === 0) return null;
  const rows = await work((db) =>
    db("o_derivedChangeInstruction").whereIn("assetsId", siblingIds).andWhere({ projectId: input.projectId }).select("assetsId", "instruction"),
  );
  const expected = equivalentStateKey(input.dimensions, input.change);
  for (const row of rows) {
    const instruction = normalizeDerivedChangeInstruction(safeParseJson(row.instruction));
    if (!instruction) continue;
    if (equivalentStateKey(instruction.dimensions, instruction.change) === expected) return row.assetsId;
  }
  return null;
}

/** 等价状态键：排序后的维度组合 + 排序后的变化声明。 */
function equivalentStateKey(dimensions: readonly VisualStateDimension[], change: readonly string[]): string {
  return JSON.stringify({ dimensions: [...dimensions].sort(), change: [...change].sort() });
}

/** 删除资产时同步清理变化契约行，避免孤儿记录（与提示词记录清理同一事务语义）。 */
export async function removeDerivedChangeInstructionRows(db: Knex, assetIds: readonly number[]): Promise<void> {
  if (assetIds.length === 0) return;
  await db("o_derivedChangeInstruction").whereIn("assetsId", [...assetIds]).delete();
}
