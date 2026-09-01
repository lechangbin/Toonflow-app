import type { Knex } from "knex";

import type { DatabaseWork } from "@/database";

/**
 * Asset Reference 领域契约（Issue #30）。
 *
 * 每个 Asset Reference 是人工上传、人工描述的授权参考图，持久化其媒体身份、
 * 顺序、必填人工描述、声明的视觉角色、必传要素与明确排除项。本版本描述来源
 * 固定为人工，AI 图像分析仅预留服务 seam（见 ./referenceImageAnalysis.ts），
 * 不实现自动分析。持久化契约不包含任何 Vendor 名称或供应商线格式。
 */

/** 单个资产最多持有的参考图数量（与当前 Agnes Image 2.1 Flash 能力一致）。 */
export const ASSET_REFERENCE_LIMIT = 6;

/** 描述来源。本版本仅落库 manual；ai 为后续自动分析预留。 */
export const ASSET_REFERENCE_DESCRIPTION_SOURCES = ["manual", "ai"] as const;
export const ASSET_REFERENCE_MANUAL_SOURCE: (typeof ASSET_REFERENCE_DESCRIPTION_SOURCES)[number] = "manual";

/** 分析生命周期状态。本版本一律落库 none，其余为预留值。 */
export const ASSET_REFERENCE_ANALYSIS_STATES = ["none", "pending", "analyzing", "analyzed", "failed"] as const;
export const ASSET_REFERENCE_ANALYSIS_NONE: (typeof ASSET_REFERENCE_ANALYSIS_STATES)[number] = "none";

export type AssetReferenceFailureKind =
  | "projectNotFound"
  | "assetNotFound"
  | "assetProjectMismatch"
  | "referenceNotFound"
  | "referenceLimitExceeded"
  | "descriptionRequired"
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
 * 媒体写入器：服务层完成所有权与数量校验后调用，负责把上传内容落盘并返回
 * 媒体身份。路由适配器注入 u.oss 实现，测试注入假实现。
 */
export type AssetReferenceMediaWriter = (target: {
  projectId: number;
  assetsId: number;
  orderIndex: number;
}) => Promise<AssetReferenceMediaIdentity>;

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
  orderMismatch: 400,
};

const FAILURE_MESSAGE: Record<AssetReferenceFailureKind, string> = {
  projectNotFound: "项目不存在",
  assetNotFound: "资产不存在",
  assetProjectMismatch: "资产不属于该项目",
  referenceNotFound: "参考图不存在或不属于该资产",
  referenceLimitExceeded: `单个资产最多支持 ${ASSET_REFERENCE_LIMIT} 张参考图`,
  descriptionRequired: "参考图描述为必填项，本版本必须由人工撰写",
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
    analysisState: row.analysisState ?? ASSET_REFERENCE_ANALYSIS_NONE,
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
 * 创建参考图。先校验所有权与 0~6 张数量限制（第 7 张在落库前被拒绝），
 * 再通过注入的媒体写入器落盘媒体，最后持久化人工契约。
 */
export async function createAssetReference(
  work: DatabaseWork,
  input: CreateAssetReferenceInput,
  writeMedia: AssetReferenceMediaWriter,
): Promise<AssetReferenceResult<AssetReferenceRecord>> {
  const description = normalizeDescription(input.description ?? "");
  if (!description) return { ok: false, failure: failure("descriptionRequired") };

  const existing = await work((db) =>
    db("o_assetReference").where({ assetsId: input.assetsId, projectId: input.projectId }).count("* as total").first(),
  );
  const currentCount = Number((existing as any)?.total ?? 0);
  if (currentCount >= ASSET_REFERENCE_LIMIT) {
    return { ok: false, failure: failure("referenceLimitExceeded") };
  }

  const ownership = await work((db) => ownedAssetFailure(db, input.projectId, input.assetsId));
  if (ownership) return { ok: false, failure: ownership };

  const media = await writeMedia({ projectId: input.projectId, assetsId: input.assetsId, orderIndex: currentCount });
  const now = Date.now();
  const record = await work((db) =>
    db.transaction(async (tx) => {
      const [id] = await tx("o_assetReference").insert({
        projectId: input.projectId,
        assetsId: input.assetsId,
        mediaPath: media.mediaPath,
        mediaMime: media.mediaMime,
        orderIndex: currentCount,
        description,
        descriptionSource: ASSET_REFERENCE_MANUAL_SOURCE,
        analysisState: ASSET_REFERENCE_ANALYSIS_NONE,
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

      for (let index = 0; index < input.orderedIds.length; index++) {
        await tx("o_assetReference")
          .where({ id: input.orderedIds[index], assetsId: input.assetsId })
          .update({ orderIndex: index, updateTime: Date.now() });
      }
      const reordered = await tx("o_assetReference")
        .where({ assetsId: input.assetsId, projectId: input.projectId })
        .orderBy("orderIndex", "asc")
        .select();
      return { ok: true as const, value: reordered.map(toRecord) };
    }),
  );
}

/**
 * 删除单张参考图并压缩剩余顺序。返回被删除参考图的媒体路径，由调用方负责
 * 删除媒体文件。
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
      for (let index = 0; index < remaining.length; index++) {
        if (remaining[index].orderIndex !== index) {
          await tx("o_assetReference").where("id", remaining[index].id).update({ orderIndex: index });
        }
      }
      return { ok: true as const, value: { mediaPath: removed.mediaPath ?? "" } };
    }),
  );
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
  return work(async (db) => {
    const rows = await db("o_assetReference").whereIn("assetsId", assetIds).select("mediaPath");
    await db("o_assetReference").whereIn("assetsId", assetIds).delete();
    return rows.map((row) => row.mediaPath ?? "").filter((mediaPath) => mediaPath.length > 0);
  });
}
