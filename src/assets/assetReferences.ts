import type { Knex } from "knex";

import type { DatabaseWork } from "@/database";

/**
 * Asset Reference 领域契约（Issue #30）。
 *
 * 每个 Asset Reference 是人工上传、人工描述的授权参考图，持久化其媒体身份、
 * 顺序、必填人工描述、声明的视觉角色、必传要素与明确排除项。本版本描述来源
 * 固定为人工，AI 图像分析仅预留服务 seam（见 ./assetReferenceAnalysis.ts），
 * 不实现自动分析。持久化契约不包含任何 Vendor 名称或供应商线格式。
 */

/** 单个资产最多持有的参考图数量（与当前 Agnes Image 2.1 Flash 能力一致）。 */
export const ASSET_REFERENCE_LIMIT = 6;

/** 描述来源。本版本仅落库 manual；ai 为后续自动分析预留。 */
export const ASSET_REFERENCE_DESCRIPTION_SOURCES = ["manual", "ai"] as const;
export const ASSET_REFERENCE_MANUAL_SOURCE: (typeof ASSET_REFERENCE_DESCRIPTION_SOURCES)[number] = "manual";

/** 已批准的分析生命周期状态。本版本一律落库 not_requested，其余为预留值。 */
export const ASSET_REFERENCE_ANALYSIS_STATES = ["not_requested", "pending", "completed", "failed"] as const;
export const ASSET_REFERENCE_ANALYSIS_NOT_REQUESTED: (typeof ASSET_REFERENCE_ANALYSIS_STATES)[number] =
  "not_requested";

export type AssetReferenceFailureKind =
  | "projectNotFound"
  | "assetNotFound"
  | "assetProjectMismatch"
  | "referenceNotFound"
  | "referenceLimitExceeded"
  | "descriptionRequired"
  | "invalidMedia"
  | "orderMismatch";

export interface AssetReferenceFailure {
  kind: AssetReferenceFailureKind;
  message: string;
}

export type AssetReferenceResult<T> = { ok: true; value: T } | { ok: false; failure: AssetReferenceFailure };

export interface AssetReferenceRecord {
  id: number;
  projectId: number;
  assetsId: number;
  mediaPath: string;
  mediaMime: string | null;
  orderIndex: number;
  description: string;
  descriptionSource: string;
  analysisState: string;
  visualRole: string;
  requiredTransfers: string[];
  exclusions: string[];
  createTime: number;
  updateTime: number;
}

/** 媒体身份：持久化的媒体路径与 MIME 类型。 */
export interface AssetReferenceMediaIdentity {
  mediaPath: string;
  mediaMime: string | null;
}

/**
 * 媒体存储：服务层完成所有权与数量校验后调用 write 落盘媒体；当数据库写入
 * 失败时调用 remove 回收媒体，避免孤儿文件。remove 必须是尽力而为的，不得
 * 抛出。路由适配器基于 u.oss 实现，测试注入假实现。
 */
export interface AssetReferenceMediaStore {
  write(target: { projectId: number; assetsId: number; orderIndex: number }): Promise<AssetReferenceMediaIdentity>;
  remove(mediaPath: string): Promise<void>;
}

export interface CreateAssetReferenceInput {
  projectId: number;
  assetsId: number;
  description: string;
  visualRole?: string;
  requiredTransfers?: readonly string[];
  exclusions?: readonly string[];
}

export interface UpdateAssetReferenceInput {
  projectId: number;
  assetsId: number;
  id: number;
  description?: string;
  visualRole?: string;
  requiredTransfers?: readonly string[];
  exclusions?: readonly string[];
}

const FAILURE_STATUS: Record<AssetReferenceFailureKind, number> = {
  projectNotFound: 404,
  assetNotFound: 404,
  referenceNotFound: 404,
  assetProjectMismatch: 403,
  referenceLimitExceeded: 400,
  descriptionRequired: 400,
  invalidMedia: 400,
  orderMismatch: 400,
};

const FAILURE_MESSAGE: Record<AssetReferenceFailureKind, string> = {
  projectNotFound: "项目不存在",
  assetNotFound: "资产不存在",
  assetProjectMismatch: "资产不属于该项目",
  referenceNotFound: "参考图不存在或不属于该资产",
  referenceLimitExceeded: `单个资产最多支持 ${ASSET_REFERENCE_LIMIT} 张参考图`,
  descriptionRequired: "参考图描述为必填项，本版本必须由人工撰写",
  invalidMedia: "参考图内容不是受支持的图片（PNG/JPEG/WebP/GIF）",
  orderMismatch: "排序列表与资产现有参考图不一致",
};

/** 稳定错误信封：所有 Asset Reference 路由共用同一 kind → 状态码/文案映射。 */
export function assetReferenceErrorEnvelope(failure: AssetReferenceFailure): {
  status: number;
  body: { code: number; data: null; message: string; error: AssetReferenceFailureKind };
} {
  const status = FAILURE_STATUS[failure.kind];
  return {
    status,
    body: {
      code: status,
      data: null,
      message: FAILURE_MESSAGE[failure.kind] ?? failure.message,
      error: failure.kind,
    },
  };
}

function failure(kind: AssetReferenceFailureKind): AssetReferenceFailure {
  return { kind, message: FAILURE_MESSAGE[kind] };
}

/** 校验 Project 与 Asset 所有权：项目存在、资产存在、资产属于该项目。 */
async function ownedAssetFailure(
  db: Knex,
  projectId: number,
  assetsId: number,
): Promise<AssetReferenceFailure | null> {
  const project = await db("o_project").where("id", projectId).first();
  if (!project) return failure("projectNotFound");
  const asset = await db("o_assets").where("id", assetsId).first();
  if (!asset) return failure("assetNotFound");
  if (asset.projectId !== projectId) return failure("assetProjectMismatch");
  return null;
}

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toRecord(row: any): AssetReferenceRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    assetsId: row.assetsId,
    mediaPath: row.mediaPath ?? "",
    mediaMime: row.mediaMime ?? null,
    orderIndex: row.orderIndex ?? 0,
    description: row.description ?? "",
    descriptionSource: row.descriptionSource ?? ASSET_REFERENCE_MANUAL_SOURCE,
    analysisState: row.analysisState ?? ASSET_REFERENCE_ANALYSIS_NOT_REQUESTED,
    visualRole: row.visualRole ?? "",
    requiredTransfers: parseJsonArray(row.requiredTransfers),
    exclusions: parseJsonArray(row.exclusions),
    createTime: row.createTime ?? 0,
    updateTime: row.updateTime ?? 0,
  };
}

function normalizeDescription(description: string): string | null {
  const trimmed = description?.trim();
  return trimmed ? trimmed : null;
}

function normalizeTransfers(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
}

/**
 * 判断数据库错误是否是 o_assetReference 上的唯一约束冲突。并发请求同时赢得
 * 准入时，(assetsId, orderIndex) 唯一索引保证只有一方落库，另一方在此被
 * 折叠为 referenceLimitExceeded，从而第 7 张被一致拒绝。
 */
function isReferenceOrderConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("UNIQUE constraint failed") && message.includes("o_assetReference");
}

/**
 * 两阶段重编号：先把现有 orderIndex 整体偏移出目标区间，再写入最终值，
 * 避免 (assetsId, orderIndex) 唯一索引在交换顺序时的临时冲突。
 */
async function renumberReferences(
  tx: Knex,
  input: { projectId: number; assetsId: number; assignments: readonly { id: number; orderIndex: number }[] },
): Promise<void> {
  await tx("o_assetReference")
    .where({ assetsId: input.assetsId, projectId: input.projectId })
    .increment("orderIndex", ASSET_REFERENCE_LIMIT);
  for (const assignment of input.assignments) {
    await tx("o_assetReference")
      .where({ id: assignment.id, assetsId: input.assetsId })
      .update({ orderIndex: assignment.orderIndex, updateTime: Date.now() });
  }
}

/** 列出一个资产的全部参考图，按持久化顺序返回。资产可以合法地持有 0 张。 */
export async function listAssetReferences(
  work: DatabaseWork,
  input: { projectId: number; assetsId: number },
): Promise<AssetReferenceResult<AssetReferenceRecord[]>> {
  return work((db) =>
    db.transaction(async (tx) => {
      const ownership = await ownedAssetFailure(tx, input.projectId, input.assetsId);
      if (ownership) return { ok: false, failure: ownership };
      const rows = await tx("o_assetReference")
        .where({ assetsId: input.assetsId, projectId: input.projectId })
        .orderBy("orderIndex", "asc")
        .orderBy("id", "asc")
        .select();
      return { ok: true as const, value: rows.map(toRecord) };
    }),
  );
}

/**
 * 创建参考图。准入（所有权 + 0~6 张数量限制）在单个事务内完成；随后通过注
 * 入的媒体存储落盘媒体，最后持久化人工契约。若数据库写入失败，已落盘的媒
 * 体会被回收；并发赢得同一顺序槽位的请求由唯一索引兜底，折叠为
 * referenceLimitExceeded。
 */
export async function createAssetReference(
  work: DatabaseWork,
  input: CreateAssetReferenceInput,
  store: AssetReferenceMediaStore,
): Promise<AssetReferenceResult<AssetReferenceRecord>> {
  const description = normalizeDescription(input.description ?? "");
  if (!description) return { ok: false, failure: failure("descriptionRequired") };

  const admission = await work((db) =>
    db.transaction(async (tx) => {
      const ownership = await ownedAssetFailure(tx, input.projectId, input.assetsId);
      if (ownership) return { ok: false as const, failure: ownership };
      const existing = await tx("o_assetReference")
        .where({ assetsId: input.assetsId, projectId: input.projectId })
        .count("* as total")
        .first();
      const total = Number((existing as any)?.total ?? 0);
      if (total >= ASSET_REFERENCE_LIMIT) {
        return { ok: false as const, failure: failure("referenceLimitExceeded") };
      }
      return { ok: true as const, orderIndex: total };
    }),
  );
  if (!admission.ok) return { ok: false, failure: admission.failure };

  const media = await store.write({
    projectId: input.projectId,
    assetsId: input.assetsId,
    orderIndex: admission.orderIndex,
  });
  const now = Date.now();
  try {
    const record = await work((db) =>
      db.transaction(async (tx) => {
        const [id] = await tx("o_assetReference").insert({
          projectId: input.projectId,
          assetsId: input.assetsId,
          mediaPath: media.mediaPath,
          mediaMime: media.mediaMime,
          orderIndex: admission.orderIndex,
          description,
          descriptionSource: ASSET_REFERENCE_MANUAL_SOURCE,
          analysisState: ASSET_REFERENCE_ANALYSIS_NOT_REQUESTED,
          visualRole: input.visualRole?.trim() ?? "",
          requiredTransfers: JSON.stringify(normalizeTransfers(input.requiredTransfers)),
          exclusions: JSON.stringify(normalizeTransfers(input.exclusions)),
          createTime: now,
          updateTime: now,
        });
        const row = await tx("o_assetReference").where("id", id).first();
        return toRecord(row);
      }),
    );
    return { ok: true, value: record };
  } catch (error) {
    // 数据库写入失败：回收已落盘媒体，避免孤儿文件
    await store.remove(media.mediaPath);
    if (isReferenceOrderConflict(error)) {
      return { ok: false, failure: failure("referenceLimitExceeded") };
    }
    throw error;
  }
}

/** 更新参考图的人工契约。描述一旦提供必须非空；来源保持 manual，分析状态不被修改。 */
export async function updateAssetReference(
  work: DatabaseWork,
  input: UpdateAssetReferenceInput,
): Promise<AssetReferenceResult<AssetReferenceRecord>> {
  const patch: Record<string, unknown> = { updateTime: Date.now() };
  if (input.description !== undefined) {
    const description = normalizeDescription(input.description);
    if (!description) return { ok: false, failure: failure("descriptionRequired") };
    patch.description = description;
  }
  if (input.visualRole !== undefined) patch.visualRole = input.visualRole.trim();
  if (input.requiredTransfers !== undefined) {
    patch.requiredTransfers = JSON.stringify(normalizeTransfers(input.requiredTransfers));
  }
  if (input.exclusions !== undefined) {
    patch.exclusions = JSON.stringify(normalizeTransfers(input.exclusions));
  }

  return work((db) =>
    db.transaction(async (tx) => {
      const ownership = await ownedAssetFailure(tx, input.projectId, input.assetsId);
      if (ownership) return { ok: false, failure: ownership };
      const updated = await tx("o_assetReference")
        .where({ id: input.id, assetsId: input.assetsId, projectId: input.projectId })
        .update(patch);
      if (!updated) return { ok: false, failure: failure("referenceNotFound") };
      const row = await tx("o_assetReference").where("id", input.id).first();
      return { ok: true as const, value: toRecord(row) };
    }),
  );
}

/** 重排参考图。orderedIds 必须是当前参考图 id 的完整排列。 */
export async function reorderAssetReferences(
  work: DatabaseWork,
  input: { projectId: number; assetsId: number; orderedIds: readonly number[] },
): Promise<AssetReferenceResult<AssetReferenceRecord[]>> {
  return work((db) =>
    db.transaction(async (tx) => {
      const ownership = await ownedAssetFailure(tx, input.projectId, input.assetsId);
      if (ownership) return { ok: false, failure: ownership };
      const rows = await tx("o_assetReference")
        .where({ assetsId: input.assetsId, projectId: input.projectId })
        .orderBy("orderIndex", "asc")
        .orderBy("id", "asc")
        .select();
      const currentIds = rows.map((row) => row.id).sort((a, b) => a - b);
      const orderedIds = [...input.orderedIds].sort((a, b) => a - b);
      const sameSet =
        currentIds.length === orderedIds.length && currentIds.every((id, index) => id === orderedIds[index]);
      if (!sameSet) return { ok: false, failure: failure("orderMismatch") };

      await renumberReferences(tx, {
        projectId: input.projectId,
        assetsId: input.assetsId,
        assignments: input.orderedIds.map((id, orderIndex) => ({ id, orderIndex })),
      });
      const reordered = await tx("o_assetReference")
        .where({ assetsId: input.assetsId, projectId: input.projectId })
        .orderBy("orderIndex", "asc")
        .select();
      return { ok: true as const, value: reordered.map(toRecord) };
    }),
  );
}

/**
 * 删除单张参考图并压缩剩余顺序。返回被删除参考图的媒体路径，由调用方在
 * 数据库删除成功后尽力清理媒体文件。
 */
export async function deleteAssetReference(
  work: DatabaseWork,
  input: { projectId: number; assetsId: number; id: number },
): Promise<AssetReferenceResult<{ mediaPath: string }>> {
  return work((db) =>
    db.transaction(async (tx) => {
      const ownership = await ownedAssetFailure(tx, input.projectId, input.assetsId);
      if (ownership) return { ok: false, failure: ownership };
      const removed = await tx("o_assetReference")
        .where({ id: input.id, assetsId: input.assetsId, projectId: input.projectId })
        .first();
      if (!removed) return { ok: false, failure: failure("referenceNotFound") };
      await tx("o_assetReference").where("id", input.id).delete();
      const remaining = await tx("o_assetReference")
        .where({ assetsId: input.assetsId, projectId: input.projectId })
        .orderBy("orderIndex", "asc")
        .orderBy("id", "asc")
        .select();
      await renumberReferences(tx, {
        projectId: input.projectId,
        assetsId: input.assetsId,
        assignments: remaining.map((row, orderIndex) => ({ id: row.id, orderIndex })),
      });
      return { ok: true as const, value: { mediaPath: removed.mediaPath ?? "" } };
    }),
  );
}

/**
 * 在给定数据库句柄（事务内）删除这些资产的全部参考图行，返回媒体路径列表
 * 供调用方清理媒体文件。供资产删除路由把参考图清理纳入同一事务。
 */
export async function removeAssetReferenceRows(db: Knex, assetIds: readonly number[]): Promise<string[]> {
  if (assetIds.length === 0) return [];
  const rows = await db("o_assetReference").whereIn("assetsId", assetIds).select("mediaPath");
  await db("o_assetReference").whereIn("assetsId", assetIds).delete();
  return rows.map((row) => row.mediaPath ?? "").filter((mediaPath) => mediaPath.length > 0);
}

/**
 * 资产删除时的清理路径：删除这些资产的全部参考图行，返回媒体路径列表供
 * 调用方删除媒体文件。SQLite 外键在运行时并不强制，删除顺序由调用方保证。
 */
export async function removeAssetReferencesForAssets(
  work: DatabaseWork,
  assetIds: readonly number[],
): Promise<string[]> {
  if (assetIds.length === 0) return [];
  return work(async (db) => removeAssetReferenceRows(db, assetIds));
}
