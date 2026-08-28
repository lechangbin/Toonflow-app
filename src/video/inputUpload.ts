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

const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function uploadVideoInputImage(
  dependencies: VideoInputUploadDependencies,
  request: VideoInputUploadRequest,
) {
  const project = await dependencies.db("o_project").where("id", request.projectId).first();
  if (!project) throw new Error(`Project ${request.projectId} 不存在`);
  const script = await dependencies.db("o_script").where({ id: request.scriptId, projectId: request.projectId }).first();
  if (!script) throw new Error(`Script ${request.scriptId} 不属于 Project ${request.projectId}`);

  const match = request.base64Data.match(/^data:([^;]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  const extension = match && imageExtensions[match[1]];
  if (!match || !extension) throw new Error("Video 输入仅支持 JPEG、PNG 或 WEBP 图片");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) throw new Error("Video 输入图片不能为空");

  const filePath = `/${request.projectId}/video-inputs/${request.scriptId}/${dependencies.createId()}.${extension}`;
  await dependencies.writeFile(filePath, bytes);
  return { filePath, url: await dependencies.getFileUrl(filePath) };
}
