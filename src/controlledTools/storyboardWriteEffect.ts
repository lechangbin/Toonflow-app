import type { Knex } from "knex";

import {
  freezeStoryboardWriteProposal, StoryboardWriteContractError,
  type StoryboardWriteInput,
} from "./storyboardWriteContract";

/**
 * Transaction-local effect primitive. Only an Owner-approved command may call it.
 * The caller owns the transaction containing Approval, Receipt and Checkpoint.
 */
export async function insertApprovedStoryboard(
  tx: Knex.Transaction,
  input: { projectId: number; payload: StoryboardWriteInput;
    payloadHash: string; targetStateHash: string; now: number },
): Promise<{ storyboardId: number; assetCount: number }> {
  const frozen = await freezeStoryboardWriteProposal(tx, input.projectId, input.payload);
  if (frozen.payloadHash !== input.payloadHash
    || frozen.targetStateHash !== input.targetStateHash) {
    throw new StoryboardWriteContractError("version");
  }
  const [storyboardId] = await tx("o_storyboard").insert({
    projectId: input.projectId, scriptId: frozen.payload.scriptId,
    trackId: frozen.payload.trackId, videoDesc: frozen.payload.videoDesc,
    prompt: frozen.payload.prompt, duration: String(frozen.payload.duration),
    filePath: null, state: "未生成",
    shouldGenerateImage: frozen.payload.shouldGenerateImage ? 1 : 0,
    createTime: input.now,
  });
  if (!Number.isSafeInteger(storyboardId) || storyboardId <= 0) {
    throw new StoryboardWriteContractError("version");
  }
  if (frozen.payload.associateAssetsIds.length) {
    await tx("o_assets2Storyboard").insert(frozen.payload.associateAssetsIds.map((assetId) => ({
      storyboardId, assetId,
    })));
  }
  return { storyboardId, assetCount: frozen.payload.associateAssetsIds.length };
}
