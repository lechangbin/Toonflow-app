import { v4 as uuidv4 } from "uuid";

import type { DatabaseWork } from "@/database";
import {
  getDefaultConfiguredVendor,
  parseVendorModelName,
  type ImageGenerationInput,
  type ImageGenerationRequest,
} from "@/vendor";
import u from "@/utils";
import { applyLegacyImageReferenceConversion, normalizeHttpResult } from "@/utils/imageGeneration";

import type { AssetReferenceRecord } from "./assetReferences";
import { detectImageMime } from "./assetReferenceMedia";
import type { AssetBriefType, AssetPromptFailure, AssetPromptResult } from "./assetBriefContract";
import {
  ASSET_PROMPT_FAILURE_ENVELOPE,
  createDefaultAssetPromptDependencies,
  resolveAssetGenerationInputs,
  type ResolvedAssetGenerationInput,
} from "./assetPromptOrchestration";

/**
 * Asset 图片生成领域模块（Issue #35）。
 *
 * 单个与批量图片生成共用同一领域入口 generateAssetImage：
 *   o_assetPromptRecord.generationPrompt（新鲜度校验，绝不静默使用过期提示词）
 *   + 有序持久化 Asset References（编译器确定性选择，orderIndex 顺序）
 *   → configured Image Vendor 接口（供应商字段翻译只存在于 Vendor adapter）
 *   → o_image 生命周期 + 脱敏 command snapshot（o_tasks，可重试可诊断）。
 *
 * 0 张参考图 = 纯文本请求，完全省略 reference media 与参考措辞；缺失、无权限、
 * 不可读、非法或超限的参考图一律在外部调用前以稳定 kind 失败。
 * HTTP 路由是薄适配器：validateFields → 领域调用 → 稳定错误信封。
 */

export type AssetImageGenerationFailureKind =
  | AssetPromptFailure["kind"]
  | "referenceMediaUnreadable"
  | "referenceMediaInvalid"
  | "imageGenerationFailed"
  | "imagePersistenceFailed"
  | "cancelled";

export interface AssetImageGenerationFailure {
  kind: AssetImageGenerationFailureKind;
  message: string;
}

export type AssetImageGenerationResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: AssetImageGenerationFailure };

/** 稳定错误信封：复用提示词域映射，叠加图片生成专属 kind → 状态码/文案。 */
const FAILURE_ENVELOPE: Record<AssetImageGenerationFailureKind, { status: number; message: string }> = {
  ...ASSET_PROMPT_FAILURE_ENVELOPE,
  referenceMediaUnreadable: { status: 500, message: "参考图媒体文件缺失或无法读取" },
  referenceMediaInvalid: { status: 500, message: "参考图媒体内容不是受支持的图片" },
  imageGenerationFailed: { status: 502, message: "图片生成调用失败" },
  imagePersistenceFailed: { status: 500, message: "生成图片写入存储失败" },
  cancelled: { status: 400, message: "生成已取消" },
};

export function assetImageGenerationErrorEnvelope(failure: AssetImageGenerationFailure): {
  status: number;
  body: { code: number; data: null; message: string; error: AssetImageGenerationFailureKind };
} {
  const envelope = FAILURE_ENVELOPE[failure.kind] ?? { status: 500, message: "资产图片生成失败" };
  return {
    status: envelope.status,
    body: {
      code: envelope.status,
      data: null,
      message: envelope.message,
      error: failure.kind,
    },
  };
}

function imageFailure(kind: AssetImageGenerationFailureKind, message: string): AssetImageGenerationFailure {
  return { kind, message };
}

/** 类型 → 目录/任务分类/标签（旧链路 role/scene/tool 语义）。 */
const IMAGE_TYPE_CONFIG: Record<AssetBriefType, { label: string; taskClass: string; dir: string }> = {
  character: { label: "角色", taskClass: "角色图生成", dir: "role" },
  scene: { label: "场景", taskClass: "场景图生成", dir: "scene" },
  prop: { label: "道具", taskClass: "道具图生成", dir: "props" },
};

export interface AssetImageTaskSnapshotInput {
  projectId: number;
  taskClass: string;
  modelId: string;
  describe: string;
  content: string;
}

export type AssetImageTaskHandle = (state: 1 | -1, reason?: string) => Promise<void>;

export interface AssetImageGenerationDependencies {
  work: DatabaseWork;
  /** 唯一的提示词/参考图解析 seam（单个与批量共用）。 */
  resolveGenerationInputs(input: {
    projectId: number;
    assetsIds: readonly number[];
  }): Promise<AssetPromptResult<ResolvedAssetGenerationInput[]>>;
  /** 读取参考图媒体；缺失/不可读时抛出。 */
  readReferenceMedia(mediaPath: string): Promise<Buffer>;
  /** configured Image Vendor seam：输入/输出都是 provider 无关契约。 */
  generateImage(request: ImageGenerationRequest): Promise<string>;
  /** Generation Task 记录（command snapshot 落点）。 */
  recordGenerationTask(input: AssetImageTaskSnapshotInput): Promise<AssetImageTaskHandle>;
  writeGeneratedImage(imagePath: string, data: string): Promise<void>;
  getImageUrl(imagePath: string): Promise<string>;
}

export interface GenerateAssetImageInput {
  projectId: number;
  assetsId: number;
  /** vendorId:modelId */
  model: string;
  resolution: string;
  /** 批量路径预置的 o_image 占位记录 id；单个路径由本模块创建。 */
  imageId?: number;
}

export interface GeneratedAssetImage {
  assetsId: number;
  imageId: number;
  imagePath: string;
  imageUrl: string;
}

interface PreparedReferenceMedia {
  reference: AssetReferenceRecord;
  base64: string;
}

function parseBatchAssetsIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids: number[] = [];
  for (const item of value) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

async function markImageFailed(
  dependencies: AssetImageGenerationDependencies,
  imageId: number,
  reason: string,
): Promise<void> {
  await dependencies
    .work((db) => db("o_image").where("id", imageId).update({ state: "生成失败", errorReason: reason }))
    .catch(() => undefined);
}

/** 参考媒体准备：读取 + magic-byte 校验 + 与持久化媒体类型一致，全部在外部调用前完成。 */
async function prepareReferenceMedia(
  dependencies: AssetImageGenerationDependencies,
  entry: ResolvedAssetGenerationInput,
): Promise<AssetImageGenerationResult<PreparedReferenceMedia[]>> {
  const referencesById = new Map(entry.references.map((reference) => [reference.id, reference]));
  const prepared: PreparedReferenceMedia[] = [];
  for (const referenceId of entry.selectedReferenceIds) {
    // referenceHash 一致性保证选中的 id 必然命中持久化参考图
    const reference = referencesById.get(referenceId)!;
    let buffer: Buffer;
    try {
      buffer = await dependencies.readReferenceMedia(reference.mediaPath);
    } catch {
      return {
        ok: false,
        failure: imageFailure("referenceMediaUnreadable", `参考图 ref-${reference.id} 媒体文件缺失或无法读取`),
      };
    }
    const detectedMime = detectImageMime(buffer);
    if (!detectedMime) {
      return {
        ok: false,
        failure: imageFailure("referenceMediaInvalid", `参考图 ref-${reference.id} 内容不是受支持的图片`),
      };
    }
    if (reference.mediaMime && reference.mediaMime !== detectedMime) {
      return {
        ok: false,
        failure: imageFailure("referenceMediaInvalid", `参考图 ref-${reference.id} 内容与持久化媒体类型不一致`),
      };
    }
    prepared.push({ reference, base64: buffer.toString("base64") });
  }
  return { ok: true, value: prepared };
}

function buildImageGenerationInput(
  entry: ResolvedAssetGenerationInput,
  prepared: readonly PreparedReferenceMedia[],
  resolution: string,
): ImageGenerationInput {
  return {
    prompt: entry.generationPrompt,
    // 旧链路语义：resolution 原样透传，由 Vendor adapter 决定兜底尺寸
    size: resolution as ImageGenerationInput["size"],
    aspectRatio: "16:9",
    // 0 张参考图 = 纯文本请求：完全省略 reference media
    ...(prepared.length > 0
      ? { referenceList: prepared.map((item) => ({ type: "image" as const, base64: item.base64 })) }
      : {}),
  };
}

/**
 * 生成单个 Asset 图片：单个与批量生成共用的唯一领域入口。
 *
 * 批量路径先经 prepareBatchAssetImages 预置 o_image 占位并传入 imageId，
 * 失败会回写占位记录（轮询可诊断）；单个路径在解析与媒体校验全部通过后
 * 才创建占位记录。重试复用同一稳定输入（同一条提示词记录与参考图）。
 */
export async function generateAssetImage(
  dependencies: AssetImageGenerationDependencies,
  input: GenerateAssetImageInput,
): Promise<AssetImageGenerationResult<GeneratedAssetImage>> {
  const projectId = Number(input?.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return { ok: false, failure: imageFailure("invalidRequest", "projectId 不合法") };
  }
  const assetsId = Number(input?.assetsId);
  if (!Number.isInteger(assetsId) || assetsId <= 0) {
    return { ok: false, failure: imageFailure("invalidRequest", "assetsId 不合法") };
  }
  if (typeof input?.model !== "string" || !input.model.trim()) {
    return { ok: false, failure: imageFailure("invalidRequest", "model 不合法") };
  }
  let target: { vendorId: string; modelId: string };
  try {
    target = parseVendorModelName(input.model);
  } catch {
    return { ok: false, failure: imageFailure("invalidRequest", "模型配置格式无效") };
  }
  const resolution = typeof input?.resolution === "string" ? input.resolution.trim() : "";
  if (!resolution) {
    return { ok: false, failure: imageFailure("invalidRequest", "resolution 不合法") };
  }

  // 批量路径的预置占位：先加载并尊重取消状态，后续失败都会回写该记录
  let imageId: number | null = null;
  if (input.imageId != null) {
    if (!Number.isInteger(input.imageId) || input.imageId <= 0) {
      return { ok: false, failure: imageFailure("invalidRequest", "imageId 不合法") };
    }
    const providedImageId: number = input.imageId;
    const placeholder = await dependencies.work((db) => db("o_image").where("id", providedImageId).first());
    if (!placeholder) return { ok: false, failure: imageFailure("assetNotFound", "图片记录不存在") };
    if (placeholder.state === "生成失败") return { ok: false, failure: imageFailure("cancelled", "生成已取消") };
    imageId = providedImageId;
  }

  // 领域解析：新鲜提示词 + 有序参考图（所有权、数量上限、新鲜度都在此判定）
  const resolved = await dependencies.resolveGenerationInputs({ projectId, assetsIds: [assetsId] });
  if (!resolved.ok) {
    if (imageId != null) {
      await markImageFailed(dependencies, imageId, `${resolved.failure.kind}: ${resolved.failure.message}`);
    }
    return { ok: false, failure: resolved.failure };
  }
  const entry = resolved.value[0];
  const typeConfig = IMAGE_TYPE_CONFIG[entry.briefType];

  // 参考媒体准备：全部在外部调用前完成
  const preparedMedia = await prepareReferenceMedia(dependencies, entry);
  if (!preparedMedia.ok) {
    if (imageId != null) {
      await markImageFailed(dependencies, imageId, `${preparedMedia.failure.kind}: ${preparedMedia.failure.message}`);
    }
    return { ok: false, failure: preparedMedia.failure };
  }

  // 单个路径：解析与媒体校验全部通过后才创建占位记录
  let imageRecordId: number;
  if (imageId == null) {
    imageRecordId = await dependencies.work(async (db) => {
      const [insertedId] = await db("o_image").insert({
        type: entry.assetRawType,
        state: "生成中",
        assetsId,
        model: target.modelId,
        resolution,
      });
      await db("o_assets").where("id", assetsId).update({ imageId: insertedId });
      return insertedId;
    });
  } else {
    imageRecordId = imageId;
    await dependencies.work((db) => db("o_assets").where("id", assetsId).update({ imageId: imageRecordId }));
  }

  // 脱敏 command snapshot：参考图身份（id/顺序/媒体类型）+ 提示词版本；不含 base64、凭证或媒体路径
  const snapshotContent = JSON.stringify({
    id: assetsId,
    projectId,
    type: typeConfig.label,
    promptRevision: entry.promptRevision,
    references: preparedMedia.value.map((item) => ({
      id: item.reference.id,
      orderIndex: item.reference.orderIndex,
      mediaMime: item.reference.mediaMime,
    })),
  });
  const describe = `生成${typeConfig.label}图，名称：${entry.name}，参考图 ${preparedMedia.value.length} 张`;

  let result: string;
  let taskDone: AssetImageTaskHandle;
  try {
    taskDone = await dependencies.recordGenerationTask({
      projectId,
      taskClass: typeConfig.taskClass,
      modelId: target.modelId,
      describe,
      content: snapshotContent,
    });
    try {
      result = await dependencies.generateImage({
        target,
        input: buildImageGenerationInput(entry, preparedMedia.value, resolution),
      });
    } catch (error) {
      const reason = u.error(error).message;
      await taskDone(-1, reason);
      await markImageFailed(dependencies, imageRecordId, reason);
      return { ok: false, failure: imageFailure("imageGenerationFailed", "图片生成调用失败") };
    }
    await taskDone(1);
  } catch (error) {
    // 任务记录或状态回写失败：按旧链路语义整体失败
    await markImageFailed(dependencies, imageRecordId, u.error(error).message);
    return { ok: false, failure: imageFailure("imageGenerationFailed", "图片生成调用失败") };
  }

  const imagePath = `/${projectId}/${typeConfig.dir}/${uuidv4()}.jpg`;
  try {
    await dependencies.writeGeneratedImage(imagePath, result);
  } catch (error) {
    await markImageFailed(dependencies, imageRecordId, u.error(error).message);
    return { ok: false, failure: imageFailure("imagePersistenceFailed", "生成图片写入存储失败") };
  }

  // 生成期间资产可能被删除（o_image 随资产清理）或被取消
  const imageRow = await dependencies.work((db) => db("o_image").where("id", imageRecordId).first());
  if (!imageRow) return { ok: false, failure: imageFailure("assetNotFound", "资产已被删除") };
  if (imageRow.state === "生成失败") return { ok: false, failure: imageFailure("cancelled", "生成已取消") };

  await dependencies.work((db) =>
    db("o_image").where("id", imageRecordId).update({
      state: "已完成",
      filePath: imagePath,
      type: entry.assetRawType,
      model: target.modelId,
      resolution,
    }),
  );
  await dependencies.work((db) => db("o_assets").where("id", assetsId).update({ imageId: imageRecordId }));

  return {
    ok: true,
    value: { assetsId, imageId: imageRecordId, imagePath, imageUrl: await dependencies.getImageUrl(imagePath) },
  };
}

export interface PrepareBatchAssetImagesInput {
  projectId: number;
  assetsIds: readonly number[];
  model: string;
  resolution: string;
}

export interface PreparedAssetImageRecord {
  assetsId: number;
  imageId: number;
}

/**
 * 批量生成预置：一次性完成所有权校验并为每个资产生成 o_image 占位，
 * 后台按占位 id 逐个调用 generateAssetImage。任何所有权失败都在占位
 * 创建前以稳定信封拒绝，不会留下孤儿记录。
 */
export async function prepareBatchAssetImages(
  dependencies: AssetImageGenerationDependencies,
  input: PrepareBatchAssetImagesInput,
): Promise<AssetImageGenerationResult<PreparedAssetImageRecord[]>> {
  const projectId = Number(input?.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return { ok: false, failure: imageFailure("invalidRequest", "projectId 不合法") };
  }
  const assetsIds = parseBatchAssetsIds(input?.assetsIds);
  if (!assetsIds) {
    return { ok: false, failure: imageFailure("invalidRequest", "assetsIds 不合法") };
  }
  if (typeof input?.model !== "string" || !input.model.trim()) {
    return { ok: false, failure: imageFailure("invalidRequest", "model 不合法") };
  }
  let target: { vendorId: string; modelId: string };
  try {
    target = parseVendorModelName(input.model);
  } catch {
    return { ok: false, failure: imageFailure("invalidRequest", "模型配置格式无效") };
  }
  const resolution = typeof input?.resolution === "string" ? input.resolution.trim() : "";
  if (!resolution) {
    return { ok: false, failure: imageFailure("invalidRequest", "resolution 不合法") };
  }

  return dependencies.work(async (db) => {
    const project = await db("o_project").where("id", projectId).first();
    if (!project) return { ok: false as const, failure: imageFailure("projectNotFound", "项目不存在") };
    const rows = await db("o_assets").whereIn("id", assetsIds).select("id", "type", "projectId");
    if (rows.length !== assetsIds.length) {
      return { ok: false as const, failure: imageFailure("assetNotFound", "部分资产不存在") };
    }
    for (const row of rows) {
      if (row.projectId !== projectId) {
        return { ok: false as const, failure: imageFailure("assetProjectMismatch", `资产 ${row.id} 不属于该项目`) };
      }
    }
    const typeById = new Map(rows.map((row) => [row.id as number, row.type as string | null]));
    const entries: PreparedAssetImageRecord[] = [];
    for (const assetsId of assetsIds) {
      const [imageId] = await db("o_image").insert({
        type: typeById.get(assetsId) ?? null,
        state: "生成中",
        assetsId,
        model: target.modelId,
        resolution,
      });
      await db("o_assets").where("id", assetsId).update({ imageId });
      entries.push({ assetsId, imageId });
    }
    return { ok: true as const, value: entries };
  });
}

/** 生产环境依赖：真实数据库与存储、提示词编排解析、configured Image Vendor。 */
export function createDefaultAssetImageGenerationDependencies(): AssetImageGenerationDependencies {
  const promptDependencies = createDefaultAssetPromptDependencies();
  return {
    work: promptDependencies.work,
    resolveGenerationInputs: (input) => resolveAssetGenerationInputs(promptDependencies, input),
    readReferenceMedia: (mediaPath) => u.oss.getFile(mediaPath),
    generateImage: async (request) => {
      const vendor = getDefaultConfiguredVendor();
      // 旧供应商（声明版本 < 2.0）的 referenceList → imageBase64 兼容翻译保持在调用方边界
      const { version } = await vendor.inspectVendor(request.target.vendorId);
      const input = applyLegacyImageReferenceConversion(version, request.input);
      const result = await vendor.generateImage({ target: request.target, input });
      return normalizeHttpResult(result);
    },
    recordGenerationTask: (input) =>
      u.task(input.projectId, input.taskClass, input.modelId, {
        describe: input.describe,
        content: input.content,
      }),
    writeGeneratedImage: (imagePath, data) => u.oss.writeFile(imagePath, data),
    getImageUrl: (imagePath) => u.oss.getSmallImageUrl(imagePath),
  };
}
