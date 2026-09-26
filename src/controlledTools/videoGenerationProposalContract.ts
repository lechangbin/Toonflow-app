import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { Knex } from "knex";
import { z } from "zod";

import { inspectPersistableText } from "@/diagnostics/traceSafeDiagnostics";
import { videoGenerationItemSchema } from "@/video/productionContract";

/** Preflight only: one existing text-to-video Track, no billable submission. */
export const videoGenerationProposalInput = z.strictObject({
  scriptId: z.number().int().positive(),
  item: videoGenerationItemSchema,
}).refine((value) => value.item.capabilityId === "text-to-video"
  && value.item.inputs.length === 0, "first supervised slice supports text-to-video only")
  .refine((value) => JSON.stringify(value).length <= 16_000, "Video proposal payload too large");

export type VideoGenerationProposalInput = z.infer<typeof videoGenerationProposalInput>;

export class VideoGenerationProposalContractError extends Error {
  constructor(readonly reason: "scope" | "unsafe" | "version") {
    super(`Video generation proposal rejected: ${reason}`);
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseStoredSelection(value: unknown): unknown {
  try { return JSON.parse(value as string); }
  catch { throw new VideoGenerationProposalContractError("unsafe"); }
}

export async function freezeVideoGenerationProposal(
  db: Knex | Knex.Transaction, projectId: number, raw: unknown,
): Promise<{ payload: VideoGenerationProposalInput; payloadJson: string;
  payloadHash: string; targetStateHash: string;
  preview: { scriptId: number; trackId: number; promptRevisionId: number;
    vendorId: string; modelId: string; capabilityId: "text-to-video";
    duration: number; payloadHash: string } }> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new VideoGenerationProposalContractError("scope");
  }
  const payload = videoGenerationProposalInput.parse(raw);
  const payloadJson = JSON.stringify(payload);
  if (!inspectPersistableText(payloadJson).ok) {
    throw new VideoGenerationProposalContractError("unsafe");
  }
  const item = payload.item;
  const [script, track] = await Promise.all([
    db("o_script").where({ id: payload.scriptId, projectId }).first("id"),
    db("o_videoTrack").where({ id: item.trackId, projectId,
      scriptId: payload.scriptId }).first(),
  ]);
  if (!script || !track) throw new VideoGenerationProposalContractError("scope");
  if (track.state !== "已完成" || track.videoId != null || track.selectVideoId != null
    || track.promptRevisionId !== item.promptRevisionId) {
    throw new VideoGenerationProposalContractError("version");
  }
  const [revision, existingVideo] = await Promise.all([
    db("o_promptRevision").where({ id: item.promptRevisionId, projectId,
      videoTrackId: item.trackId, status: "active" }).first(),
    db("o_video").where({ projectId, videoTrackId: item.trackId }).first("id"),
  ]);
  if (!revision || existingVideo) throw new VideoGenerationProposalContractError("version");
  if (typeof revision.renderedPrompt !== "string" || !revision.renderedPrompt.trim()
    || revision.renderedPrompt.length > 16_000) {
    throw new VideoGenerationProposalContractError("unsafe");
  }
  const actualSelection = {
    vendorId: track.vendorId, modelId: track.modelId,
    capabilityId: track.capabilityId,
    inputs: parseStoredSelection(track.inputRefs),
    output: parseStoredSelection(track.outputSelection),
    audio: parseStoredSelection(track.audioSelection),
  };
  const proposedSelection = { vendorId: item.vendorId, modelId: item.modelId,
    capabilityId: item.capabilityId, inputs: item.inputs,
    output: item.output, audio: item.audio };
  if (!isDeepStrictEqual(actualSelection, proposedSelection)
    || Number(track.duration) !== item.output.duration) {
    throw new VideoGenerationProposalContractError("version");
  }
  const payloadHash = hash(payloadJson);
  const targetStateHash = hash(JSON.stringify({ projectId,
    scriptId: payload.scriptId, trackId: item.trackId,
    trackState: track.state, selectedVideoId: track.selectVideoId ?? null,
    videoId: track.videoId ?? null, selection: proposedSelection,
    promptRevision: { id: revision.id, status: revision.status,
      profileId: revision.profileId, strategy: revision.strategy,
      briefHash: hash(String(revision.brief ?? "")),
      draftHash: hash(String(revision.draft ?? "")),
      renderedPromptHash: hash(revision.renderedPrompt) },
  }));
  return { payload, payloadJson, payloadHash, targetStateHash,
    preview: { scriptId: payload.scriptId, trackId: item.trackId,
      promptRevisionId: item.promptRevisionId, vendorId: item.vendorId,
      modelId: item.modelId, capabilityId: "text-to-video",
      duration: item.output.duration, payloadHash } };
}
