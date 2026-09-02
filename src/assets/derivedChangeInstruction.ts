import type { Knex } from "knex";
import { z } from "zod";

import type { DatabaseWork } from "@/database";

import type { AssetBriefType } from "./assetBriefContract";

/**
 * Derived Change Instruction 领域契约（Issue #37，ADR-0007）。
 *
 * Production Agent 在衍生分析阶段写入的结构化、带版本的变化契约：声明
 * changeKind、剧本证据、必须从父资产继承的 preserve、允许发生的 change 与
 * 禁止出现的 exclude。name/desc 只是展示字段，不构成可执行契约；图片生成
 * 阶段用本契约与 Parent Asset Anchor 确定性编译最终提示词，不调用 Text Model。
 *
 * 兼容策略：旧衍生资产没有契约记录时，非空 desc 走确定性 legacy_description
 * 转换（类型映射 changeKind + 类型化 preserve/exclude 默认值 + desc 原文作为
 * 唯一允许变化），空 desc 或父关系异常时要求重新衍生分析。
 */

/** 变化类型：与当前提取范围一一对应（角色换装/特效/变形、场景时间、旧道具状态）。 */
export const DERIVED_CHANGE_KINDS = [
  "character_wardrobe",
  "character_effect",
  "character_morphology",
  "scene_time",
  "legacy_prop_state",
] as const;

export type DerivedChangeKind = (typeof DERIVED_CHANGE_KINDS)[number];

/** 契约来源：agent = 衍生分析写入；legacy_description = 旧 desc 确定性转换。 */
export const DERIVED_CHANGE_INSTRUCTION_SOURCES = ["agent", "legacy_description"] as const;

export type DerivedChangeInstructionSource = (typeof DERIVED_CHANGE_INSTRUCTION_SOURCES)[number];

export const derivedChangeInstructionSchema = z
  .object({
    changeKind: z.enum(DERIVED_CHANGE_KINDS),
    evidence: z.array(z.string().min(1)),
    preserve: z.array(z.string().min(1)).min(1),
    change: z.array(z.string().min(1)).min(1),
    exclude: z.array(z.string().min(1)),
  })
  .strict();

export type DerivedChangeInstruction = z.infer<typeof derivedChangeInstructionSchema>;

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

/** changeKind 与资产规范类型的一致性校验（确定性，不依赖模型）。 */
const CHANGE_KINDS_BY_BRIEF_TYPE: Record<AssetBriefType, readonly DerivedChangeKind[]> = {
  character: ["character_wardrobe", "character_effect", "character_morphology"],
  scene: ["scene_time"],
  prop: ["legacy_prop_state"],
};

export function isChangeKindCompatibleWithBriefType(changeKind: DerivedChangeKind, briefType: AssetBriefType): boolean {
  return CHANGE_KINDS_BY_BRIEF_TYPE[briefType].includes(changeKind);
}

/** changeKind → 规范类型的正向映射（与 CHANGE_KINDS_BY_BRIEF_TYPE 反向同源，消除重复 switch）。 */
export function changeKindBriefType(changeKind: DerivedChangeKind): AssetBriefType {
  const briefType = (Object.keys(CHANGE_KINDS_BY_BRIEF_TYPE) as AssetBriefType[]).find((briefType) =>
    CHANGE_KINDS_BY_BRIEF_TYPE[briefType].includes(changeKind),
  );
  return briefType ?? "character";
}

/** 旧 desc → changeKind 的确定性类型映射。 */
const LEGACY_CHANGE_KIND_BY_BRIEF_TYPE: Record<AssetBriefType, DerivedChangeKind> = {
  character: "character_wardrobe",
  scene: "scene_time",
  prop: "legacy_prop_state",
};

/** 类型化 preserve 默认值：旧记录无契约内容时的确定性继承清单。 */
const LEGACY_PRESERVE_BY_KIND: Record<DerivedChangeKind, readonly string[]> = {
  character_wardrobe: ["脸部拓扑", "体型轮廓", "发型结构", "标志性细节"],
  character_effect: ["脸部拓扑", "体型轮廓", "发型结构", "服装结构", "标志性细节"],
  character_morphology: ["脸部拓扑", "发型结构", "标志性细节"],
  scene_time: ["空间结构", "核心地标", "建造方式", "材料工艺", "尺度"],
  legacy_prop_state: ["几何轮廓", "材料工艺", "辨识标记"],
};

/** 类型化 exclude 默认值。 */
const LEGACY_EXCLUDE_BY_KIND: Record<DerivedChangeKind, readonly string[]> = {
  character_wardrobe: ["背景变化", "文字", "水印", "额外角色"],
  character_effect: ["背景变化", "文字", "水印", "额外角色"],
  character_morphology: ["背景变化", "文字", "水印", "额外角色"],
  scene_time: ["人物", "文字", "水印"],
  legacy_prop_state: ["人物", "手部", "持握关系", "文字", "水印"],
};

/**
 * 旧 desc 的确定性兼容转换：非空 desc 作为唯一允许变化，changeKind 与
 * preserve/exclude 按类型取默认值；不调用模型、不虚构证据。空 desc 返回
 * null —— 该记录必须重新衍生分析。
 */
export function legacyInstructionFromDescription(input: {
  describe: string | null | undefined;
  briefType: AssetBriefType;
}): DerivedChangeInstruction | null {
  const describe = input.describe?.trim();
  if (!describe) return null;
  const changeKind = LEGACY_CHANGE_KIND_BY_BRIEF_TYPE[input.briefType];
  return {
    changeKind,
    evidence: [],
    preserve: [...LEGACY_PRESERVE_BY_KIND[changeKind]],
    change: [describe],
    exclude: [...LEGACY_EXCLUDE_BY_KIND[changeKind]],
  };
}

export interface SaveDerivedChangeInstructionInput {
  projectId: number;
  assetsId: number;
  instruction: unknown;
  source: DerivedChangeInstructionSource;
  /** 可选：校验 changeKind 与资产规范类型一致（衍生分析工具按父资产类型传入）。 */
  expectedBriefType?: AssetBriefType;
  now?: () => number;
}

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
  const parsed = derivedChangeInstructionSchema.safeParse(safeParseJson(row.instruction));
  if (!parsed.success) {
    return { ok: false, kind: "derivedChangeInstructionInvalid", message: "持久化的变化契约不是合法 JSON 或不符合 Schema" };
  }
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
  return {
    ok: true,
    value: {
      id: row.id,
      projectId: row.projectId,
      assetsId: row.assetsId,
      source,
      revision: row.revision,
      instruction: parsed.data,
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

/**
 * 写入或更新衍生资产的变化契约：同一资产 upsert，revision 在已有记录上
 * 递增，保证父图/契约变化后的失效判定与诊断都有单调版本可依。
 */
export async function saveDerivedChangeInstruction(
  work: DatabaseWork,
  input: SaveDerivedChangeInstructionInput,
): Promise<DerivedChangeInstructionResult<DerivedChangeInstructionRecord>> {
  const parsed = derivedChangeInstructionSchema.safeParse(input.instruction);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      kind: "derivedChangeInstructionInvalid",
      message: `变化契约不符合 Schema（${issue?.path?.join(".") ?? ""}）: ${issue?.message ?? "结构错误"}`,
    };
  }
  const instruction = parsed.data;
  if (input.expectedBriefType && !isChangeKindCompatibleWithBriefType(instruction.changeKind, input.expectedBriefType)) {
    return {
      ok: false,
      kind: "derivedChangeInstructionInvalid",
      message: `变化类型 ${instruction.changeKind} 与资产类型 ${input.expectedBriefType} 不一致`,
    };
  }
  const now = (input.now ?? Date.now)();
  const record = await work(async (db) =>
    db.transaction(async (tx) => {
      const existing = await tx("o_derivedChangeInstruction")
        .where({ assetsId: input.assetsId, projectId: input.projectId })
        .first();
      if (existing) {
        const revision = (existing.revision ?? 1) + 1;
        await tx("o_derivedChangeInstruction").where("id", existing.id).update({
          source: input.source,
          revision,
          instruction: JSON.stringify(instruction),
          updateTime: now,
        });
        return { id: existing.id, revision };
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
      return { id, revision: 1 };
    }),
  );
  return {
    ok: true,
    value: {
      id: record.id,
      projectId: input.projectId,
      assetsId: input.assetsId,
      source: input.source,
      revision: record.revision,
      instruction,
      createTime: now,
      updateTime: now,
    },
  };
}

/**
 * 读取变化契约。value 为 null 表示该资产尚无契约记录；持久化行存在但内容
 * 非法时返回 derivedChangeInstructionInvalid，调用方不得回退到纯文本。
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

/** 删除资产时同步清理变化契约行，避免孤儿记录（与提示词记录清理同一事务语义）。 */
export async function removeDerivedChangeInstructionRows(db: Knex, assetIds: readonly number[]): Promise<void> {
  if (assetIds.length === 0) return;
  await db("o_derivedChangeInstruction").whereIn("assetsId", [...assetIds]).delete();
}
