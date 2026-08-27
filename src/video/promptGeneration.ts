import { Output } from "ai";
import { z } from "zod";

import u from "@/utils";
import { videoCapabilityIdSchema } from "./capability";
import {
  VideoPromptProfileRegistry,
  createVideoPromptDraftInstruction,
  promptStrategySchema,
  renderVideoPrompt,
  videoPromptBriefSchema,
  videoPromptDraftSchema,
} from "./promptProfile";

export const generateVideoPromptRequestSchema = z
  .object({
    trackId: z.number().int().positive(),
    projectId: z.number().int().positive(),
    vendorId: z.string().min(1),
    modelId: z.string().min(1),
    capabilityId: videoCapabilityIdSchema,
    requestedBy: z.enum(["user", "project-agent"]).default("user"),
    strategy: z.enum(["standard", "standard-with-guidance"]),
    brief: videoPromptBriefSchema,
  })
  .strict();

export type GenerateVideoPromptRequest = z.infer<typeof generateVideoPromptRequestSchema>;

export async function generateVideoPromptRevision(inputValue: unknown) {
  const input = generateVideoPromptRequestSchema.parse(inputValue);
  const track = await u.db("o_videoTrack").where({ id: input.trackId, projectId: input.projectId }).first();
  if (!track) throw new Error(`Video Track ${input.trackId} 不属于 Project ${input.projectId}`);
  const models = await u.vendor.getModelList(input.vendorId);
  const model = models.find((item: any) => item.modelName === input.modelId && item.type === "video");
  const capability = model?.capabilities?.find((item: any) => item.id === input.capabilityId);
  if (!capability) throw new Error(`${input.vendorId}:${input.modelId} 不支持 ${input.capabilityId}`);

  const registry = VideoPromptProfileRegistry.load(u.getPath(["promptProfiles", "video"]));
  const profile = registry.get(capability.promptProfileId);
  const [actionId] = await u.db("o_productionAction").insert({
    projectId: input.projectId,
    actionType: "generate-video-prompt",
    requestedBy: input.requestedBy,
    status: "running",
    createdAt: Date.now(),
  });
  await u.db("o_videoTrack").where("id", input.trackId).update({ state: "生成中", reason: null });

  try {
    const instruction = createVideoPromptDraftInstruction(profile, input.brief, input.strategy);
    const result = await u.Ai.Text("universalAi").invoke({
      prompt: instruction,
      output: Output.object({ schema: videoPromptDraftSchema, name: "video_prompt_draft" }),
    });
    const draft = videoPromptDraftSchema.parse(result.output);
    const renderedPrompt = renderVideoPrompt(profile, draft);
    const [promptRevisionId] = await u.db.transaction(async (trx) => {
      await trx("o_promptRevision").where({ videoTrackId: input.trackId, status: "active" }).update({ status: "superseded" });
      const ids = await trx("o_promptRevision").insert({
        projectId: input.projectId,
        videoTrackId: input.trackId,
        profileId: profile.id,
        strategy: input.strategy,
        brief: JSON.stringify(input.brief),
        draft: JSON.stringify(draft),
        renderedPrompt,
        status: "active",
        createdAt: Date.now(),
      });
      await trx("o_videoTrack").where("id", input.trackId).update({
        vendorId: input.vendorId,
        modelId: input.modelId,
        capabilityId: input.capabilityId,
        promptRevisionId: ids[0],
        state: "已完成",
      });
      await trx("o_productionAction").where("id", actionId).update({ status: "succeeded", completedAt: Date.now() });
      return ids;
    });
    return {
      actionId,
      promptRevisionId,
      profileId: profile.id,
      strategy: input.strategy,
      brief: input.brief,
      draft,
      renderedPrompt,
    };
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    await u.db.transaction(async (trx) => {
      await trx("o_videoTrack").where("id", input.trackId).update({ state: "生成失败", reason: message });
      await trx("o_productionAction").where("id", actionId).update({ status: "failed", completedAt: Date.now() });
    });
    throw error;
  }
}

export const customVideoPromptRevisionSchema = z
  .object({
    trackId: z.number().int().positive(),
    projectId: z.number().int().positive(),
    requestedBy: z.enum(["user", "project-agent"]).default("user"),
    renderedPrompt: z.string().min(1),
  })
  .strict();

export async function createCustomVideoPromptRevision(inputValue: unknown) {
  const input = customVideoPromptRevisionSchema.parse(inputValue);
  return u.db.transaction(async (trx) => {
    const track = await trx("o_videoTrack").where({ id: input.trackId, projectId: input.projectId }).first();
    if (!track?.promptRevisionId) throw new Error("Video Track 尚无可编辑的 Prompt Revision");
    const current = await trx("o_promptRevision").where("id", track.promptRevisionId).first();
    if (!current) throw new Error(`Prompt Revision ${track.promptRevisionId} 不存在`);
    const [actionId] = await trx("o_productionAction").insert({
      projectId: input.projectId,
      actionType: "edit-video-prompt",
      requestedBy: input.requestedBy,
      status: "succeeded",
      createdAt: Date.now(),
      completedAt: Date.now(),
    });
    await trx("o_promptRevision").where("id", current.id).update({ status: "superseded" });
    const [promptRevisionId] = await trx("o_promptRevision").insert({
      projectId: input.projectId,
      videoTrackId: input.trackId,
      profileId: current.profileId,
      strategy: promptStrategySchema.enum.custom,
      brief: current.brief,
      draft: null,
      renderedPrompt: input.renderedPrompt,
      status: "active",
      createdAt: Date.now(),
    });
    await trx("o_videoTrack").where("id", input.trackId).update({ promptRevisionId, state: "已完成", reason: null });
    return { actionId, promptRevisionId, renderedPrompt: input.renderedPrompt, strategy: "custom" as const };
  });
}
