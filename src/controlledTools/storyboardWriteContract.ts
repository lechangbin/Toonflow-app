import { createHash } from "node:crypto";

import type { Knex } from "knex";
import { z } from "zod";

import { inspectPersistableText } from "@/diagnostics/traceSafeDiagnostics";

/** One proposed Storyboard on an existing Video Track; no write occurs here. */
export const storyboardWriteInput = z.strictObject({
  scriptId: z.number().int().positive(),
  trackId: z.number().int().positive(),
  videoDesc: z.string().trim().min(1).max(8_000),
  prompt: z.string().max(4_000).nullable(),
  duration: z.number().int().min(1).max(60),
  shouldGenerateImage: z.boolean(),
  associateAssetsIds: z.array(z.number().int().positive()).max(16)
    .refine((ids) => new Set(ids).size === ids.length, "duplicate Asset IDs"),
}).refine((value) => JSON.stringify(value).length <= 16_000, "Storyboard payload too large");

export type StoryboardWriteInput = z.infer<typeof storyboardWriteInput>;

export class StoryboardWriteContractError extends Error {
  constructor(readonly reason: "scope" | "unsafe" | "version") {
    super(`Storyboard proposal rejected: ${reason}`);
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Local preflight only; the future approval command must rerun it in its commit transaction. */
export async function freezeStoryboardWriteProposal(
  db: Knex | Knex.Transaction, projectId: number, raw: unknown,
): Promise<{ payload: StoryboardWriteInput; payloadJson: string; payloadHash: string;
  targetStateHash: string; preview: { scriptId: number; trackId: number;
    duration: number; assetCount: number; payloadHash: string } }> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new StoryboardWriteContractError("scope");
  const payload = storyboardWriteInput.parse(raw);
  const payloadJson = JSON.stringify(payload);
  if (!inspectPersistableText(payloadJson).ok) throw new StoryboardWriteContractError("unsafe");
  const [script, track] = await Promise.all([
    db("o_script").where({ id: payload.scriptId, projectId }).first("id", "projectId"),
    db("o_videoTrack").where({ id: payload.trackId, projectId,
      scriptId: payload.scriptId }).first(),
  ]);
  if (!script || !track) throw new StoryboardWriteContractError("scope");
  if (track.videoId != null || track.selectVideoId != null) {
    throw new StoryboardWriteContractError("version");
  }
  const assets = payload.associateAssetsIds.length
    ? await db("o_assets").where({ projectId })
      .whereIn("id", payload.associateAssetsIds).select("id", "projectId", "scriptId", "assetsId")
    : [];
  if (assets.length !== payload.associateAssetsIds.length) {
    throw new StoryboardWriteContractError("scope");
  }
  const linked = assets.length ? await db("o_scriptAssets")
    .where({ scriptId: payload.scriptId }).whereIn("assetId", payload.associateAssetsIds)
    .select("assetId") : [];
  const linkedIds = new Set(linked.map((item) => item.assetId));
  if (assets.some((asset) => asset.scriptId !== payload.scriptId
    && !linkedIds.has(asset.id))) throw new StoryboardWriteContractError("scope");
  const payloadHash = hash(payloadJson);
  const targetStateHash = hash(JSON.stringify({ projectId, scriptId: script.id,
    track: { id: track.id, projectId: track.projectId, scriptId: track.scriptId,
      videoId: track.videoId, selectVideoId: track.selectVideoId,
      duration: track.duration, vendorId: track.vendorId, modelId: track.modelId,
      capabilityId: track.capabilityId },
    assets: assets.sort((a, b) => a.id - b.id).map((asset) => ({ id: asset.id,
      scriptId: asset.scriptId, assetsId: asset.assetsId,
      linked: linkedIds.has(asset.id) })) }));
  return { payload, payloadJson, payloadHash, targetStateHash,
    preview: { scriptId: payload.scriptId, trackId: payload.trackId,
      duration: payload.duration, assetCount: assets.length, payloadHash } };
}
