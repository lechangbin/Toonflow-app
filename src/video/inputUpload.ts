import type { Knex } from "knex";

export interface VideoInputUploadDependencies {
  db: Knex;
  createId(): string;
  writeFile(filePath: string, bytes: Buffer): Promise<void>;
  getFileUrl(filePath: string): Promise<string>;
}

export interface VideoInputUploadRequest {
  projectId: number;
  scriptId: number;
  base64Data: string;
}

type ImageFormat = "jpeg" | "png" | "webp";

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const imageExtensions: Record<ImageFormat, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

function detectImageFormat(bytes: Buffer): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export async function uploadVideoInputImage(
  dependencies: VideoInputUploadDependencies,
  request: VideoInputUploadRequest,
) {
  const project = await dependencies.db("o_project").where("id", request.projectId).first();
  if (!project) throw new Error(`Project ${request.projectId} 不存在`);
  const script = await dependencies.db("o_script").where({ id: request.scriptId, projectId: request.projectId }).first();
  if (!script) throw new Error(`Script ${request.scriptId} 不属于 Project ${request.projectId}`);

  const match = request.base64Data.match(/^data:([^;]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || !allowedMimeTypes.has(match[1])) {
    throw new Error("Video 输入仅支持 JPEG、PNG 或 WEBP 图片");
  }
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) throw new Error("Video 输入图片不能为空");
  const format = detectImageFormat(bytes);
  if (!format) throw new Error("Video 输入图片损坏或格式不支持");

  const extension = imageExtensions[format];
  const filePath = `/${request.projectId}/video-inputs/${request.scriptId}/${dependencies.createId()}.${extension}`;
  await dependencies.writeFile(filePath, bytes);
  return { filePath, url: await dependencies.getFileUrl(filePath) };
}
