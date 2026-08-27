import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import axios from "axios";
import { v4 as uuid } from "uuid";

import { loadVendorRuntime } from "@/lib/vendorRuntime";
import db from "@/utils/db";
import getPath from "@/utils/getPath";
import oss from "@/utils/oss";
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
  runtime: ReturnType<typeof loadVendorRuntime>;
}

export interface StartedVideoGenerationBatch {
  actionId: number;
  tasks: { trackId: number; videoId: number; generationTaskId: number; artifactRevisionId: number }[];
  completion: Promise<void>;
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

async function resolveInputPath(reference: VideoTrackInputReference): Promise<string> {
  if (reference.source === "uploaded-media") return reference.filePath!;
  if (reference.source === "storyboard") {
    const row = await db("o_storyboard").where("id", reference.sourceId).select("filePath").first();
    if (!row?.filePath) throw new Error(`Storyboard ${reference.sourceId} 没有可用图片`);
    return row.filePath;
  }
  const row = await db("o_assets")
    .where("o_assets.id", reference.sourceId)
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .select("o_image.filePath")
    .first();
  if (!row?.filePath) throw new Error(`Asset ${reference.sourceId} 没有可用图片`);
  return row.filePath;
}

async function resolveImages(references: VideoTrackInputReference[]): Promise<Map<string, ResolvedImage>> {
  const roles = new Set<string>();
  const resolved = new Map<string, ResolvedImage>();
  for (const reference of references) {
    if (roles.has(reference.role)) throw new Error(`输入角色 ${reference.role} 只能出现一次`);
    roles.add(reference.role);
    const filePath = await resolveInputPath(reference);
    resolved.set(reference.role, { mediaType: "image", base64: await oss.getImageBase64(filePath) });
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

async function loadRuntime(vendorId: string) {
  const vendorConfig = await db("o_vendorConfig").where("id", vendorId).first();
  if (!vendorConfig) throw new Error(`未找到供应商 ${vendorId}`);
  const sourcePath = path.join(getPath("vendor"), `${vendorId}.ts`);
  if (!fs.existsSync(sourcePath)) throw new Error(`未找到供应商配置文件 ${vendorId}.ts`);
  return loadVendorRuntime(fs.readFileSync(sourcePath, "utf8"), {
    inputValues: JSON.parse(vendorConfig.inputValues ?? "{}"),
    customModels: JSON.parse(vendorConfig.models ?? "[]"),
  });
}

async function materializePrompt(
  item: VideoGenerationItem,
  projectId: number,
  profiles: VideoPromptProfileRegistry,
): Promise<{ profileId: string; renderedPrompt: string }> {
  const revision = await db("o_promptRevision")
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

async function normalizeAdapterResult(result: string): Promise<string> {
  if (!result.startsWith("http")) return result;
  const response = await axios.get(result, { responseType: "arraybuffer" });
  return Buffer.from(response.data).toString("base64");
}

async function executePrepared(prepared: PreparedGeneration): Promise<boolean> {
  const request = prepared.runtime.getRequest("videoRequest", prepared.command.modelId);
  const command = {
    ...prepared.command,
    onTaskCheckpoint: async (checkpoint: unknown) => {
      await db("o_generationTask")
        .where("id", prepared.generationTaskId)
        .update({ providerTaskSnapshot: serialize(checkpoint) });
    },
  };
  try {
    const result = await request(command);
    await oss.writeFile(prepared.videoPath, await normalizeAdapterResult(result));
    const completedAt = Date.now();
    await db.transaction(async (trx) => {
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
    });
    return true;
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = Date.now();
    await db.transaction(async (trx) => {
      await trx("o_video").where("id", prepared.videoId).update({ state: "生成失败", errorReason: message });
      await trx("o_videoTrack").where("id", prepared.trackId).update({ state: "生成失败", reason: message });
      await trx("o_artifactRevision").where("id", prepared.artifactRevisionId).update({ status: "rejected" });
      await trx("o_generationTask")
        .where("id", prepared.generationTaskId)
        .update({ status: "failed", completedAt, error: message });
    });
    return false;
  }
}

export async function startVideoGenerationBatch(inputValue: unknown): Promise<StartedVideoGenerationBatch> {
  const input = videoGenerationBatchRequestSchema.parse(inputValue);
  const profiles = VideoPromptProfileRegistry.load(getPath(["promptProfiles", "video"]));
  const preparedItems: Omit<PreparedGeneration, "trackId" | "videoId" | "generationTaskId" | "artifactRevisionId">[] = [];

  for (const item of input.items) {
    const track = await db("o_videoTrack")
      .where({ id: item.trackId, projectId: input.projectId, scriptId: input.scriptId })
      .first();
    if (!track) throw new Error(`Video Track ${item.trackId} 不属于当前 Project/Script`);
    const runtime = await loadRuntime(item.vendorId);
    const model = runtime.getModel(item.modelId);
    const capability = model.type === "video" && Array.isArray(model.capabilities)
      ? (model.capabilities as any[]).find((candidate) => candidate.id === item.capabilityId)
      : undefined;
    if (!capability) throw new Error(`${item.vendorId}:${item.modelId} 不支持 ${item.capabilityId}`);
    validateVideoTrackInputReferences(capability, item.inputs);
    const promptRevision = await materializePrompt(item, input.projectId, profiles);
    if (capability.promptProfileId !== promptRevision.profileId) {
      throw new Error(`${item.modelId}/${item.capabilityId} 要求 Prompt Profile ${capability.promptProfileId}`);
    }
    const images = await resolveImages(item.inputs);
    const command = validateVideoGenerationCommand(model, buildCommand(item, promptRevision.renderedPrompt, images));
    preparedItems.push({
      command,
      runtime,
      videoPath: `/${input.projectId}/video/${uuid()}.mp4`,
    });
  }

  const prepared: PreparedGeneration[] = [];
  const actionId = await db.transaction(async (trx) => {
    const [newActionId] = await trx("o_productionAction").insert({
      projectId: input.projectId,
      actionType: "generate-video",
      requestedBy: input.requestedBy,
      status: "running",
      createdAt: Date.now(),
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
        startedAt: Date.now(),
      });
      const [videoId] = await trx("o_video").insert({
        filePath: preparedItems[index].videoPath,
        time: Date.now(),
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
        createdAt: Date.now(),
      });
      await trx("o_video").where("id", videoId).update({ artifactRevisionId });
      prepared.push({ ...preparedItems[index], trackId: item.trackId, videoId, generationTaskId, artifactRevisionId });
    }
    return newActionId;
  });

  const completion = Promise.all(prepared.map((item) => executePrepared(item))).then(async (results) => {
    const successes = results.filter(Boolean).length;
    const status = successes === results.length ? "succeeded" : successes === 0 ? "failed" : "partial";
    await db("o_productionAction").where("id", actionId).update({ status, completedAt: Date.now() });
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
