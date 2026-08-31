import crypto from "node:crypto";

import axios from "axios";
import type { Knex } from "knex";
import { v4 as uuid } from "uuid";

import { getDatabaseRuntime, type DatabaseWork } from "@/database";
import getPath from "@/utils/getPath";
import oss from "@/utils/oss";
import { getDefaultConfiguredVendor, type ConfiguredVendor } from "@/vendor";
import {
  validateVideoGenerationCommand,
  type ResolvedImage,
  type ValidatedVideoGenerationCommand,
} from "./capability";
import {
  VideoPromptProfileRegistry,
  renderVideoPrompt,
  videoPromptBriefSchema,
  videoPromptDraftSchema,
} from "./promptProfile";
import {
  videoGenerationBatchRequestSchema,
  validateVideoTrackInputReferences,
  type VideoGenerationItem,
  type VideoTrackInputReference,
} from "./productionContract";

export { videoGenerationBatchRequestSchema, videoGenerationItemSchema } from "./productionContract";
export type { VideoGenerationBatchRequest } from "./productionContract";

interface PreparedGeneration {
  trackId: number;
  videoId: number;
  videoPath: string;
  generationTaskId: number;
  artifactRevisionId: number;
  command: ValidatedVideoGenerationCommand;
  vendorId: string;
}

/**
 * The configured-Vendor surface Video production needs: capability inspection
 * before persistence and typed generation at the source runtime boundary. Video
 * production keeps its own loader out of the picture entirely.
 */
export type VideoVendorPort = Pick<ConfiguredVendor, "inspectVendor" | "generateVideo">;

export interface VideoProductionDependencies {
  db: DatabaseWork;
  profiles: VideoPromptProfileRegistry;
  vendor: VideoVendorPort;
  readImage(filePath: string): Promise<string>;
  writeVideo(filePath: string, base64: string): Promise<unknown>;
  downloadVideo(url: string): Promise<string>;
  createVideoPath(projectId: number): string;
  now(): number;
}

export interface StartedVideoGenerationBatch {
  actionId: number;
  tasks: { trackId: number; videoId: number; generationTaskId: number; artifactRevisionId: number }[];
  completion: Promise<void>;
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

async function resolveInputPath(database: Knex, reference: VideoTrackInputReference): Promise<string> {
  if (reference.source === "uploaded-media") return reference.filePath!;
  if (reference.source === "storyboard") {
    const row = await database("o_storyboard").where("id", reference.sourceId).select("filePath").first();
    if (!row?.filePath) throw new Error(`Storyboard ${reference.sourceId} 没有可用图片`);
    return row.filePath;
  }
  const row = await database("o_assets")
    .where("o_assets.id", reference.sourceId)
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .select("o_image.filePath")
    .first();
  if (!row?.filePath) throw new Error(`Asset ${reference.sourceId} 没有可用图片`);
  return row.filePath;
}

async function resolveImages(
  dependencies: VideoProductionDependencies,
  references: VideoTrackInputReference[],
): Promise<Map<string, ResolvedImage>> {
  const roles = new Set<string>();
  const resolved = new Map<string, ResolvedImage>();
  for (const reference of references) {
    if (roles.has(reference.role)) throw new Error(`输入角色 ${reference.role} 只能出现一次`);
    roles.add(reference.role);
    const filePath = await dependencies.db((db) => resolveInputPath(db, reference));
    resolved.set(reference.role, { mediaType: "image", base64: await dependencies.readImage(filePath) });
  }
  return resolved;
}

function buildCommand(
  item: VideoGenerationItem,
  prompt: string,
  images: Map<string, ResolvedImage>,
): unknown {
  const base = {
    capabilityId: item.capabilityId,
    modelId: item.modelId,
    prompt,
    output: item.output,
    audio: item.audio,
  };
  switch (item.capabilityId) {
    case "text-to-video":
      if (images.size) throw new Error("text-to-video 不接受图片输入");
      return base;
    case "image-to-video":
      return { ...base, sourceImage: images.get("source-image") };
    case "first-last-frame":
      return { ...base, firstFrame: images.get("first-frame"), lastFrame: images.get("last-frame") };
    case "keyframe-to-video":
      return {
        ...base,
        firstFrame: images.get("first-frame"),
        intermediateKeyframe: images.get("intermediate-keyframe"),
        lastFrame: images.get("last-frame"),
      };
  }
}

function commandSnapshot(
  command: ValidatedVideoGenerationCommand,
  references: VideoTrackInputReference[],
): Record<string, unknown> {
  const redactImage = (image: ResolvedImage | undefined, role: string) =>
    image
      ? {
          mediaType: image.mediaType,
          sha256: crypto.createHash("sha256").update(image.base64).digest("hex"),
          source: references.find((reference) => reference.role === role),
        }
      : undefined;
  const snapshot: Record<string, unknown> = { ...command };
  delete snapshot.onTaskCheckpoint;
  delete snapshot.sourceImage;
  delete snapshot.firstFrame;
  delete snapshot.intermediateKeyframe;
  delete snapshot.lastFrame;
  if (command.capabilityId === "image-to-video") snapshot.sourceImage = redactImage(command.sourceImage, "source-image");
  if (command.capabilityId === "first-last-frame" || command.capabilityId === "keyframe-to-video") {
    snapshot.firstFrame = redactImage(command.firstFrame, "first-frame");
    snapshot.lastFrame = redactImage(command.lastFrame, "last-frame");
  }
  if (command.capabilityId === "keyframe-to-video" && command.intermediateKeyframe) {
    snapshot.intermediateKeyframe = redactImage(command.intermediateKeyframe, "intermediate-keyframe");
  }
  return snapshot;
}

async function materializePrompt(
  database: Knex,
  item: VideoGenerationItem,
  projectId: number,
  profiles: VideoPromptProfileRegistry,
): Promise<{ profileId: string; renderedPrompt: string }> {
  const revision = await database("o_promptRevision")
    .where({ id: item.promptRevisionId, projectId, videoTrackId: item.trackId })
    .first();
  if (!revision) throw new Error(`Prompt Revision ${item.promptRevisionId} 不属于当前 Project/Track`);
  const profile = profiles.get(revision.profileId);
  if (profile.capabilityId !== item.capabilityId) {
    throw new Error(`Prompt Profile ${profile.id} 不适用于 ${item.capabilityId}`);
  }
  if (revision.strategy === "custom") return { profileId: profile.id, renderedPrompt: revision.renderedPrompt };
  const brief = videoPromptBriefSchema.safeParse(JSON.parse(revision.brief ?? "null"));
  const draft = videoPromptDraftSchema.safeParse(JSON.parse(revision.draft ?? "null"));
  if (!brief.success || !draft.success) {
    throw new Error(`${revision.strategy} Prompt Revision 必须包含有效的 brief 和 draft`);
  }
  const rendered = renderVideoPrompt(profile, draft.data);
  if (rendered !== revision.renderedPrompt) {
    throw new Error("renderedPrompt 与结构化 Draft 的确定性渲染结果不一致");
  }
  return { profileId: profile.id, renderedPrompt: rendered };
}

async function normalizeAdapterResult(dependencies: VideoProductionDependencies, result: string): Promise<string> {
  if (!result.startsWith("http")) return result;
  return dependencies.downloadVideo(result);
}

async function executePrepared(dependencies: VideoProductionDependencies, prepared: PreparedGeneration): Promise<boolean> {
  const command = {
    ...prepared.command,
    onTaskCheckpoint: async (checkpoint: unknown) => {
      await dependencies.db((db) =>
        db("o_generationTask")
          .where("id", prepared.generationTaskId)
          .update({ providerTaskSnapshot: serialize(checkpoint) }),
      );
    },
  };
  try {
    const result = await dependencies.vendor.generateVideo({
      target: { vendorId: prepared.vendorId, modelId: prepared.command.modelId },
      input: command,
    });
    await dependencies.writeVideo(prepared.videoPath, await normalizeAdapterResult(dependencies, result));
    const completedAt = dependencies.now();
    await dependencies.db((db) =>
      db.transaction(async (trx) => {
        await trx("o_video")
          .where("id", prepared.videoId)
          .update({ state: "生成成功", artifactRevisionId: prepared.artifactRevisionId });
        await trx("o_videoTrack").where("id", prepared.trackId).update({ state: "已完成", reason: null });
        await trx("o_artifactRevision").where("id", prepared.artifactRevisionId).update({ status: "generated" });
        await trx("o_generationTask").where("id", prepared.generationTaskId).update({
          status: "succeeded",
          artifactRevisionId: prepared.artifactRevisionId,
          completedAt,
        });
      }),
    );
    return true;
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = dependencies.now();
    await dependencies.db((db) =>
      db.transaction(async (trx) => {
        await trx("o_video").where("id", prepared.videoId).update({ state: "生成失败", errorReason: message });
        await trx("o_videoTrack").where("id", prepared.trackId).update({ state: "生成失败", reason: message });
        await trx("o_artifactRevision").where("id", prepared.artifactRevisionId).update({ status: "rejected" });
        await trx("o_generationTask")
          .where("id", prepared.generationTaskId)
          .update({ status: "failed", completedAt, error: message });
      }),
    );
    return false;
  }
}

export function createVideoProduction(dependencies: VideoProductionDependencies) {
async function startVideoGenerationBatch(inputValue: unknown): Promise<StartedVideoGenerationBatch> {
  const input = videoGenerationBatchRequestSchema.parse(inputValue);
  const profiles = dependencies.profiles;
  const preparedItems: Omit<PreparedGeneration, "trackId" | "videoId" | "generationTaskId" | "artifactRevisionId">[] = [];

  for (const item of input.items) {
    const track = await dependencies.db((db) =>
      db("o_videoTrack")
        .where({ id: item.trackId, projectId: input.projectId, scriptId: input.scriptId })
        .first(),
    );
    if (!track) throw new Error(`Video Track ${item.trackId} 不属于当前 Project/Script`);
    const inspection = await dependencies.vendor.inspectVendor(item.vendorId);
    const model = inspection.models.find(
      (candidate) => candidate.type === "video" && candidate.modelName === item.modelId,
    );
    if (!model || model.type !== "video") {
      throw new Error(`未找到 Video Model ${item.vendorId}:${item.modelId}`);
    }
    const capability = model.capabilities.find((candidate) => candidate.id === item.capabilityId);
    if (!capability) throw new Error(`${item.vendorId}:${item.modelId} 不支持 ${item.capabilityId}`);
    validateVideoTrackInputReferences(capability, item.inputs);
    const promptRevision = await dependencies.db((db) => materializePrompt(db, item, input.projectId, profiles));
    if (capability.promptProfileId !== promptRevision.profileId) {
      throw new Error(`${item.modelId}/${item.capabilityId} 要求 Prompt Profile ${capability.promptProfileId}`);
    }
    const images = await resolveImages(dependencies, item.inputs);
    const command = validateVideoGenerationCommand(model, buildCommand(item, promptRevision.renderedPrompt, images));
    preparedItems.push({
      command,
      vendorId: item.vendorId,
      videoPath: dependencies.createVideoPath(input.projectId),
    });
  }

  const prepared: PreparedGeneration[] = [];
  const actionId = await dependencies.db((db) =>
    db.transaction(async (trx) => {
      const [newActionId] = await trx("o_productionAction").insert({
        projectId: input.projectId,
        actionType: "generate-video",
        requestedBy: input.requestedBy,
        status: "running",
        createdAt: dependencies.now(),
      });

      for (const [index, item] of input.items.entries()) {
        const track = await trx("o_videoTrack")
          .where({ id: item.trackId, projectId: input.projectId, scriptId: input.scriptId })
          .first();
        if (!track) throw new Error(`Video Track ${item.trackId} 不属于当前 Project/Script`);
        await trx("o_videoTrack").where("id", item.trackId).update({
          vendorId: item.vendorId,
          modelId: item.modelId,
          capabilityId: item.capabilityId,
          inputRefs: serialize(item.inputs),
          outputSelection: serialize(item.output),
          audioSelection: serialize(item.audio),
          promptRevisionId: item.promptRevisionId,
          duration: item.output.duration,
          state: "生成中",
          reason: null,
        });
        const [generationTaskId] = await trx("o_generationTask").insert({
          actionId: newActionId,
          projectId: input.projectId,
          videoTrackId: item.trackId,
          vendorId: item.vendorId,
          modelId: item.modelId,
          capabilityId: item.capabilityId,
          promptRevisionId: item.promptRevisionId,
          commandSnapshot: serialize(commandSnapshot(preparedItems[index].command, item.inputs)),
          status: "running",
          startedAt: dependencies.now(),
        });
        const [videoId] = await trx("o_video").insert({
          filePath: preparedItems[index].videoPath,
          time: dependencies.now(),
          state: "生成中",
          scriptId: input.scriptId,
          projectId: input.projectId,
          videoTrackId: item.trackId,
          generationTaskId,
        });
        const revisionRow = await trx("o_artifactRevision")
          .where("videoTrackId", item.trackId)
          .max<{ revision?: number }>("revision as revision")
          .first();
        const [artifactRevisionId] = await trx("o_artifactRevision").insert({
          actionId: newActionId,
          generationTaskId,
          videoId,
          videoTrackId: item.trackId,
          revision: (revisionRow?.revision ?? 0) + 1,
          status: "draft",
          createdAt: dependencies.now(),
        });
        await trx("o_video").where("id", videoId).update({ artifactRevisionId });
        prepared.push({ ...preparedItems[index], trackId: item.trackId, videoId, generationTaskId, artifactRevisionId });
      }
      return newActionId;
    }),
  );

  const completion = Promise.all(prepared.map((item) => executePrepared(dependencies, item))).then(async (results) => {
    const successes = results.filter(Boolean).length;
    const status = successes === results.length ? "succeeded" : successes === 0 ? "failed" : "partial";
    await dependencies.db((db) =>
      db("o_productionAction").where("id", actionId).update({ status, completedAt: dependencies.now() }),
    );
  });

  return {
    actionId,
    tasks: prepared.map((item, index) => ({
      trackId: input.items[index].trackId,
      videoId: item.videoId,
      generationTaskId: item.generationTaskId,
      artifactRevisionId: item.artifactRevisionId,
    })),
    completion,
  };
}

return { startVideoGenerationBatch };
}

function createDefaultVideoProduction() {
  return createVideoProduction({
    db: (operation) => getDatabaseRuntime().work(operation),
    profiles: VideoPromptProfileRegistry.load(getPath(["promptProfiles", "video"])),
    vendor: getDefaultConfiguredVendor(),
    readImage: (filePath) => oss.getImageBase64(filePath),
    writeVideo: (filePath, base64) => oss.writeFile(filePath, base64),
    downloadVideo: async (url) => {
      const response = await axios.get(url, { responseType: "arraybuffer" });
      return Buffer.from(response.data).toString("base64");
    },
    createVideoPath: (projectId) => `/${projectId}/video/${uuid()}.mp4`,
    now: Date.now,
  });
}

export function startVideoGenerationBatch(inputValue: unknown): Promise<StartedVideoGenerationBatch> {
  return createDefaultVideoProduction().startVideoGenerationBatch(inputValue);
}
