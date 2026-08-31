import { Output } from "ai";
import { z } from "zod";

import { getDatabaseRuntime, type DatabaseWork } from "@/database";
import u from "@/utils";
import { getDefaultConfiguredVendor } from "@/vendor";
import { validateVideoCapabilitySelection } from "./capability";
import { validateVideoTrackInputReferences, videoTrackSelectionSchema } from "./productionContract";
import {
  VideoPromptProfileRegistry,
  createVideoPromptDraftInstruction,
  promptStrategySchema,
  renderVideoPrompt,
  videoPromptBriefSchema,
  videoPromptDraftSchema,
} from "./promptProfile";

export const generateVideoPromptRequestSchema = videoTrackSelectionSchema
  .extend({
    trackId: z.number().int().positive(),
    projectId: z.number().int().positive(),
    requestedBy: z.enum(["user", "project-agent"]).default("user"),
    strategy: z.enum(["standard", "standard-with-guidance"]),
    brief: videoPromptBriefSchema,
  })
  .strict();

export type GenerateVideoPromptRequest = z.infer<typeof generateVideoPromptRequestSchema>;

export const customVideoPromptRevisionSchema = videoTrackSelectionSchema
  .extend({
    trackId: z.number().int().positive(),
    projectId: z.number().int().positive(),
    requestedBy: z.enum(["user", "project-agent"]).default("user"),
    renderedPrompt: z.string().min(1),
  })
  .strict();

export interface VideoPromptGenerationDependencies {
  db: DatabaseWork;
  profiles: VideoPromptProfileRegistry;
  getVendorModels(vendorId: string): Promise<readonly any[]>;
  generateDraft(instruction: string): Promise<unknown>;
  now(): number;
}

export function createVideoPromptGeneration(dependencies: VideoPromptGenerationDependencies) {
function serialize(value: unknown): string {
  return JSON.stringify(value);
}

async function validateTrackSelection(input: z.infer<typeof videoTrackSelectionSchema>) {
  const models = await dependencies.getVendorModels(input.vendorId);
  const model = models.find((item: any) => item.modelName === input.modelId && item.type === "video");
  if (!model) throw new Error(`未找到 Video Model ${input.vendorId}:${input.modelId}`);
  const capability = validateVideoCapabilitySelection(model, input);
  validateVideoTrackInputReferences(capability, input.inputs);
  return capability;
}

async function generateVideoPromptRevision(inputValue: unknown) {
  const input = generateVideoPromptRequestSchema.parse(inputValue);
  const track = await dependencies.db((db) =>
    db("o_videoTrack").where({ id: input.trackId, projectId: input.projectId }).first(),
  );
  if (!track) throw new Error(`Video Track ${input.trackId} 不属于 Project ${input.projectId}`);
  const capability = await validateTrackSelection(input);

  const profile = dependencies.profiles.get(capability.promptProfileId);
  const [actionId] = await dependencies.db((db) =>
    db("o_productionAction").insert({
      projectId: input.projectId,
      actionType: "generate-video-prompt",
      requestedBy: input.requestedBy,
      status: "running",
      createdAt: dependencies.now(),
    }),
  );
  await dependencies.db((db) => db("o_videoTrack").where("id", input.trackId).update({ state: "生成中", reason: null }));

  try {
    const instruction = createVideoPromptDraftInstruction(profile, input.brief, input.strategy);
    const draft = videoPromptDraftSchema.parse(await dependencies.generateDraft(instruction));
    const renderedPrompt = renderVideoPrompt(profile, draft);
    const [promptRevisionId] = await dependencies.db((db) =>
      db.transaction(async (trx) => {
        await trx("o_promptRevision")
          .where({ videoTrackId: input.trackId, status: "active" })
          .update({ status: "superseded" });
        const ids = await trx("o_promptRevision").insert({
          projectId: input.projectId,
          videoTrackId: input.trackId,
          profileId: profile.id,
          strategy: input.strategy,
          brief: JSON.stringify(input.brief),
          draft: JSON.stringify(draft),
          renderedPrompt,
          status: "active",
          createdAt: dependencies.now(),
        });
        await trx("o_videoTrack").where("id", input.trackId).update({
          vendorId: input.vendorId,
          modelId: input.modelId,
          capabilityId: input.capabilityId,
          inputRefs: serialize(input.inputs),
          outputSelection: serialize(input.output),
          audioSelection: serialize(input.audio),
          promptRevisionId: ids[0],
          duration: input.output.duration,
          state: "已完成",
        });
        await trx("o_productionAction")
          .where("id", actionId)
          .update({ status: "succeeded", completedAt: dependencies.now() });
        return ids;
      }),
    );
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
    await dependencies.db((db) =>
      db.transaction(async (trx) => {
        await trx("o_videoTrack").where("id", input.trackId).update({ state: "生成失败", reason: message });
        await trx("o_productionAction")
          .where("id", actionId)
          .update({ status: "failed", completedAt: dependencies.now() });
      }),
    );
    throw error;
  }
}

async function createCustomVideoPromptRevision(inputValue: unknown) {
  const input = customVideoPromptRevisionSchema.parse(inputValue);
  const capability = await validateTrackSelection(input);
  return dependencies.db((db) =>
    db.transaction(async (trx) => {
      const track = await trx("o_videoTrack").where({ id: input.trackId, projectId: input.projectId }).first();
      if (!track?.promptRevisionId) throw new Error("Video Track 尚无可编辑的 Prompt Revision");
      const current = await trx("o_promptRevision")
        .where({ id: track.promptRevisionId, projectId: input.projectId, videoTrackId: input.trackId })
        .first();
      if (!current) throw new Error(`Prompt Revision ${track.promptRevisionId} 不属于当前 Project/Track`);
      if (current.profileId !== capability.promptProfileId) {
        throw new Error(`${input.modelId}/${input.capabilityId} 要求 Prompt Profile ${capability.promptProfileId}`);
      }
      const [actionId] = await trx("o_productionAction").insert({
        projectId: input.projectId,
        actionType: "edit-video-prompt",
        requestedBy: input.requestedBy,
        status: "succeeded",
        createdAt: dependencies.now(),
        completedAt: dependencies.now(),
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
        createdAt: dependencies.now(),
      });
      await trx("o_videoTrack").where("id", input.trackId).update({
        vendorId: input.vendorId,
        modelId: input.modelId,
        capabilityId: input.capabilityId,
        inputRefs: serialize(input.inputs),
        outputSelection: serialize(input.output),
        audioSelection: serialize(input.audio),
        promptRevisionId,
        duration: input.output.duration,
        state: "已完成",
        reason: null,
      });
      return { actionId, promptRevisionId, renderedPrompt: input.renderedPrompt, strategy: "custom" as const };
    }),
  );
}

return { generateVideoPromptRevision, createCustomVideoPromptRevision };
}

function createDefaultVideoPromptGeneration() {
  return createVideoPromptGeneration({
    db: (operation) => getDatabaseRuntime().work(operation),
    profiles: VideoPromptProfileRegistry.load(u.getPath(["promptProfiles", "video"])),
    getVendorModels: (vendorId) =>
      getDefaultConfiguredVendor().inspectVendor(vendorId).then((inspection) => inspection.models),
    generateDraft: async (instruction) => {
      const result = await getDefaultConfiguredVendor().invokeText({
        target: { kind: "logical", key: "universalAi" },
        input: {
          prompt: instruction,
          output: Output.object({ schema: videoPromptDraftSchema, name: "video_prompt_draft" }),
        },
      });
      return result.output;
    },
    now: Date.now,
  });
}

export function generateVideoPromptRevision(inputValue: unknown) {
  return createDefaultVideoPromptGeneration().generateVideoPromptRevision(inputValue);
}

export function createCustomVideoPromptRevision(inputValue: unknown) {
  return createDefaultVideoPromptGeneration().createCustomVideoPromptRevision(inputValue);
}
