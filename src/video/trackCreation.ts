import type { Knex } from "knex";

import { parseVideoModel, videoOutputSelectionSchema, type VideoCapability } from "./capability";

export interface CreateVideoTrackDependencies {
  db: Knex;
  getVendorModels(vendorId: string): Promise<unknown[]>;
}

export interface CreateVideoTrackInput {
  id: number;
  projectId: number;
  scriptId: number;
  duration?: number;
}

export interface CreatedVideoTrack {
  id: number;
  projectId: number;
  scriptId: number;
  duration: number;
  vendorId: string;
  modelId: string;
  capabilityId: string;
  inputRefs: [];
  outputSelection: {
    presetId: string;
    duration: number;
    resolution: string;
    aspectRatio: "16:9" | "9:16";
  };
}

function getDefaultDuration(capability: VideoCapability, presetId: string): number {
  const preset = capability.outputPresets.find((candidate) => candidate.id === presetId);
  if (!preset) throw new Error(`Video Capability ${capability.id} 没有 Output Preset ${presetId}`);
  return preset.durations.kind === "values" ? preset.durations.values[0] : preset.durations.min;
}

export async function createVideoTrack(
  dependencies: CreateVideoTrackDependencies,
  input: CreateVideoTrackInput,
): Promise<CreatedVideoTrack> {
  const project = await dependencies.db("o_project").where("id", input.projectId).first();
  if (!project) throw new Error(`Project ${input.projectId} 不存在`);
  if (!project.videoVendorId || !project.videoModelId || !project.videoCapabilityId || !project.videoOutputPresetId) {
    throw new Error("项目尚未配置完整的 Video Capability 默认值");
  }

  const rawModel = (await dependencies.getVendorModels(project.videoVendorId)).find(
    (candidate: any) => candidate?.type === "video" && candidate.modelName === project.videoModelId,
  );
  if (!rawModel) throw new Error(`项目默认 Video Model ${project.videoVendorId}:${project.videoModelId} 已失效`);
  const model = parseVideoModel(rawModel);
  const capability = model.capabilities.find((candidate) => candidate.id === project.videoCapabilityId);
  if (!capability) throw new Error(`项目默认 Video Capability ${project.videoCapabilityId} 已失效`);
  const preset = capability.outputPresets.find((candidate) => candidate.id === project.videoOutputPresetId);
  if (!preset || !preset.aspectRatios.includes(project.videoRatio)) {
    throw new Error("项目默认 Video Capability/Output Preset 已失效");
  }

  const duration = input.duration ?? getDefaultDuration(capability, preset.id);
  const outputSelection = videoOutputSelectionSchema.parse({
    presetId: preset.id,
    duration,
    resolution: preset.resolution,
    aspectRatio: project.videoRatio,
  });
  const durationAllowed =
    preset.durations.kind === "values"
      ? preset.durations.values.includes(duration)
      : duration >= preset.durations.min &&
        duration <= preset.durations.max &&
        (duration - preset.durations.min) % preset.durations.step === 0;
  if (!durationAllowed) throw new Error(`时长 ${duration}s 不属于 Output Preset ${preset.id}`);

  const track: CreatedVideoTrack = {
    id: input.id,
    projectId: input.projectId,
    scriptId: input.scriptId,
    duration,
    vendorId: project.videoVendorId,
    modelId: project.videoModelId,
    capabilityId: project.videoCapabilityId,
    inputRefs: [],
    outputSelection,
  };
  await dependencies.db("o_videoTrack").insert({
    ...track,
    inputRefs: JSON.stringify(track.inputRefs),
    outputSelection: JSON.stringify(track.outputSelection),
  });
  return track;
}
