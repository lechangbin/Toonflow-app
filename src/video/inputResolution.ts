import type { Knex } from "knex";

import type { VideoTrackInputReference } from "./productionContract";

/** Resolve an image only inside the exact Project and Script being generated. */
export async function resolveVideoInputPath(
  db: Knex | Knex.Transaction, reference: VideoTrackInputReference,
  projectId: number, scriptId: number,
): Promise<string> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0
    || !Number.isSafeInteger(scriptId) || scriptId <= 0) {
    throw new Error("Video input Project/Script scope is invalid");
  }
  if (reference.source === "uploaded-media") {
    const prefix = `/${projectId}/video-inputs/${scriptId}/`;
    const path = reference.filePath;
    if (!path?.startsWith(prefix)
      || !/^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/u.test(path.slice(prefix.length))) {
      throw new Error("Uploaded Video input does not belong to this Project/Script");
    }
    return path;
  }
  if (reference.source === "storyboard") {
    const row = await db("o_storyboard")
      .where({ id: reference.sourceId, projectId, scriptId }).first("filePath");
    if (!row?.filePath) throw new Error("Storyboard Video input is unavailable in this Project/Script");
    return row.filePath;
  }
  const asset = await db("o_assets").where({ id: reference.sourceId, projectId })
    .first("id", "scriptId", "imageId");
  if (!asset) throw new Error("Asset Video input is unavailable in this Project");
  if (asset.scriptId !== scriptId) {
    const link = await db("o_scriptAssets")
      .where({ scriptId, assetId: asset.id }).first("assetId");
    if (!link) throw new Error("Asset Video input is not linked to this Script");
  }
  const image = asset.imageId && await db("o_image").where("id", asset.imageId).first("filePath");
  if (!image?.filePath) throw new Error("Asset Video input has no usable image");
  return image.filePath;
}
