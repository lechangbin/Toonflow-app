import type { Knex } from "knex";

import { parseVideoModel, videoAudioSelectionSchema, videoOutputSelectionSchema } from "./capability";
import { videoTrackInputReferenceSchema } from "./productionContract";
import { videoPromptBriefSchema, videoPromptDraftSchema } from "./promptProfile";

export interface VideoWorkbenchReadDependencies {
  db: Knex;
  getVendorModels(vendorId: string): Promise<unknown[]>;
  getFileUrl(filePath: string): Promise<string>;
}

export interface VideoWorkbenchReadInput {
  projectId: number;
  scriptId: number;
}

function parseJson(label: string, value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} 包含无效 JSON`);
  }
}

function parsePersisted<T>(label: string, value: string | null | undefined, parse: (input: unknown) => T): T | null {
  if (value == null || value === "") return null;
  try {
    return parse(parseJson(label, value));
  } catch (error) {
    if (error instanceof Error && error.message === `${label} 包含无效 JSON`) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} 无效：${message}`);
  }
}

function artifactProjection(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    revision: row.revision,
    status: row.status,
    videoId: row.videoId,
    generationTaskId: row.generationTaskId,
    createdAt: row.createdAt,
  };
}

async function deriveAudioSelection(
  dependencies: VideoWorkbenchReadDependencies,
  track: any,
  latestTask: any,
) {
  if (latestTask?.commandSnapshot) {
    const snapshot = parseJson(`Generation Task ${latestTask.id} commandSnapshot`, latestTask.commandSnapshot) as any;
    return videoAudioSelectionSchema.parse(snapshot?.audio);
  }
  if (!track.vendorId || !track.modelId || !track.capabilityId) return null;
  const rawModel = (await dependencies.getVendorModels(track.vendorId)).find(
    (candidate: any) => candidate?.type === "video" && candidate.modelName === track.modelId,
  );
  if (!rawModel) throw new Error(`Video Track ${track.id} 引用不存在的 Model ${track.vendorId}:${track.modelId}`);
  const model = parseVideoModel(rawModel);
  const capability = model.capabilities.find((candidate) => candidate.id === track.capabilityId);
  if (!capability) throw new Error(`Video Track ${track.id} 引用不存在的 Capability ${track.capabilityId}`);
  if (capability.audio.generation === "none") return { generation: "none" as const };
  if (capability.audio.policy === "always") return { generation: "native" as const, enabled: true as const };
  return null;
}

export async function readVideoTrackProjections(
  dependencies: VideoWorkbenchReadDependencies,
  input: VideoWorkbenchReadInput,
): Promise<any[]> {
  const tracks = await dependencies.db("o_videoTrack").where({ projectId: input.projectId, scriptId: input.scriptId });
  if (!tracks.length) return [];
  const trackIds = tracks.map((track) => track.id);
  const videos = await dependencies.db("o_video").whereIn("videoTrackId", trackIds);
  const tasks = await dependencies.db("o_generationTask").whereIn("videoTrackId", trackIds).orderBy("id", "asc");
  const artifacts = await dependencies.db("o_artifactRevision").whereIn("videoTrackId", trackIds).orderBy("revision", "asc");

  return Promise.all(
    tracks.map(async (track) => {
      const selectionFields = [track.vendorId, track.modelId, track.capabilityId];
      const configuredFieldCount = selectionFields.filter(Boolean).length;
      if (configuredFieldCount !== 0 && configuredFieldCount !== selectionFields.length) {
        throw new Error(`Video Track ${track.id} 的 Vendor/Model/Capability 实际选择不完整`);
      }
      const inputs = parsePersisted(`Video Track ${track.id} inputRefs`, track.inputRefs, (value) =>
        videoTrackInputReferenceSchema.array().parse(value),
      );
      const projectedInputs = inputs
        ? await Promise.all(
            inputs.map(async (reference) =>
              reference.source === "uploaded-media"
                ? { ...reference, displayUrl: await dependencies.getFileUrl(reference.filePath!) }
                : reference,
            ),
          )
        : null;
      const output = parsePersisted(`Video Track ${track.id} outputSelection`, track.outputSelection, (value) =>
        videoOutputSelectionSchema.parse(value),
      );

      let promptRevision = null;
      if (track.promptRevisionId) {
        const revision = await dependencies.db("o_promptRevision").where("id", track.promptRevisionId).first();
        if (!revision || revision.projectId !== input.projectId || revision.videoTrackId !== track.id) {
          throw new Error(`Prompt Revision ${track.promptRevisionId} 不属于 Project ${input.projectId} / Video Track ${track.id}`);
        }
        const brief = parsePersisted(`Prompt Revision ${revision.id} brief`, revision.brief, (value) =>
          videoPromptBriefSchema.parse(value),
        );
        const draft = parsePersisted(`Prompt Revision ${revision.id} draft`, revision.draft, (value) =>
          videoPromptDraftSchema.parse(value),
        );
        promptRevision = {
          id: revision.id,
          profileId: revision.profileId,
          strategy: revision.strategy,
          brief,
          draft,
          renderedPrompt: revision.renderedPrompt,
          status: revision.status,
          createdAt: revision.createdAt,
        };
      }

      const trackTasks = tasks.filter((task) => task.videoTrackId === track.id);
      const latestTask = trackTasks.at(-1);
      const trackArtifacts = artifacts.filter((artifact) => artifact.videoTrackId === track.id);
      const latestArtifact = trackArtifacts.at(-1);
      const selectedVideo = track.videoId ? videos.find((video) => video.id === track.videoId) : undefined;
      if (track.videoId && !selectedVideo) {
        throw new Error(`Video ${track.videoId} 不属于 Video Track ${track.id}`);
      }
      const selectedArtifact = selectedVideo?.artifactRevisionId
        ? trackArtifacts.find((artifact) => artifact.id === selectedVideo.artifactRevisionId)
        : undefined;
      if (selectedVideo?.artifactRevisionId && !selectedArtifact) {
        throw new Error(`Artifact Revision ${selectedVideo.artifactRevisionId} 不属于 Video Track ${track.id}`);
      }

      const videoList = await Promise.all(
        videos
          .filter((video) => video.videoTrackId === track.id)
          .map(async (video) => {
            const artifact = video.artifactRevisionId
              ? trackArtifacts.find((candidate) => candidate.id === video.artifactRevisionId)
              : undefined;
            if (video.artifactRevisionId && !artifact) {
              throw new Error(`Artifact Revision ${video.artifactRevisionId} 不属于 Video Track ${track.id}`);
            }
            return {
              id: video.id,
              src: video.filePath ? await dependencies.getFileUrl(video.filePath) : "",
              state:
                video.state === "生成成功"
                  ? "已完成"
                  : video.state === "生成中"
                    ? "生成中"
                    : video.state === "生成失败"
                      ? "生成失败"
                      : "未生成",
              errorReason: video.errorReason ?? "",
              generationTaskId: video.generationTaskId ?? null,
              artifactRevision: artifactProjection(artifact),
            };
          }),
      );

      return {
        id: track.id,
        duration: track.duration ?? 0,
        prompt: promptRevision?.renderedPrompt ?? "",
        promptRevision,
        state: track.state ?? "未生成",
        reason: track.reason ?? "",
        selectVideoId: track.videoId ?? null,
        selectedArtifact: artifactProjection(selectedArtifact),
        currentArtifact: artifactProjection(latestArtifact),
        actual: {
          vendorId: track.vendorId ?? null,
          modelId: track.modelId ?? null,
          capabilityId: track.capabilityId ?? null,
          inputs: projectedInputs,
          output,
          audio: await deriveAudioSelection(dependencies, track, latestTask),
          promptRevisionId: track.promptRevisionId ?? null,
        },
        videoList,
      };
    }),
  );
}
