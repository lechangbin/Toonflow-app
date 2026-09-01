import u from "@/utils";

/**
 * Asset Reference 媒体工具（Issue #30）。
 *
 * 上传内容必须通过 magic bytes 验证为受支持的图片，而不是相信请求声明的
 * MIME 或 Base64 字符串；媒体清理统一走本模块，避免各路由复制相同的容错
 * 形状。
 */

export type SupportedAssetReferenceImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

const MIME_EXTENSIONS: Record<SupportedAssetReferenceImageMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** 通过文件头识别受支持的图片类型；无法识别时返回 null。 */
export function detectImageMime(buffer: Buffer): SupportedAssetReferenceImageMime | null {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6) {
    const header = buffer.toString("ascii", 0, 6);
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** 受支持图片类型对应的文件扩展名。 */
export function extensionForMime(mime: SupportedAssetReferenceImageMime): string {
  return MIME_EXTENSIONS[mime];
}

/**
 * 删除媒体文件；文件已不存在（ENOENT）视为成功，其余错误向上抛出。
 * 适用于数据库删除之前执行的清理：失败时调用方尚未提交任何数据库变更。
 */
export async function deleteMediaFileIfPresent(mediaPath: string): Promise<void> {
  try {
    await u.oss.deleteFile(mediaPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
}

/**
 * 尽力而为地删除媒体文件，永不抛出。适用于数据库记录已删除之后的清理：
 * 此时媒体残留只是孤儿文件，不应让 API 报告与持久状态不一致的失败。
 */
export async function deleteMediaFileBestEffort(mediaPath: string): Promise<void> {
  try {
    await deleteMediaFileIfPresent(mediaPath);
  } catch (error) {
    console.warn("[assetReference] 媒体文件清理失败:", mediaPath, error);
  }
}
