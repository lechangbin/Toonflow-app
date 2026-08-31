import type { DatabaseWork } from "@/database";

import { deriveAudioSelection, parseVideoModel, videoAudioSelectionSchema, videoOutputSelectionSchema } from "./capability";
import { videoTrackInputReferenceSchema } from "./productionContract";
import { videoPromptBriefSchema, videoPromptDraftSchema } from "./promptProfile";

export interface VideoWorkbenchReadDependencies {
  db: DatabaseWork;
  getVendorModels(vendorId: string): Promise<readonly unknown[]>;
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

async function resolveAudioSelection(
  dependencies: VideoWorkbenchReadDependencies,
  track: any,
  latestTask: any,
) {
  const persisted = parsePersisted(`Video Track ${track.id} audioSelection`, track.audioSelection, (value) =>
    videoAudioSelectionSchema.parse(value),
  );
  if (persisted) return persisted;
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
  return deriveAudioSelection(capability.audio);
}

export async function readVideoTrackProjections(
  dependencies: VideoWorkbenchReadDependencies,
  input: VideoWorkbenchReadInput,
): Promise<any[]> {
  const { tracks, videos, tasks, artifacts } = await dependencies.db(async (db) => {
    const tracks = await db("o_videoTrack").where({ projectId: input.projectId, scriptId: input.scriptId });
    if (!tracks.length) return { tracks: [] as any[], videos: [] as any[], tasks: [] as any[], artifacts: [] as any[] };
    const trackIds = tracks.map((track) => track.id);
    const [videos, tasks, artifacts] = await Promise.all([
      db("o_video").whereIn("videoTrackId", trackIds),
      db("o_generationTask").whereIn("videoTrackId", trackIds).orderBy("id", "asc"),
      db("o_artifactRevision").whereIn("videoTrackId", trackIds).orderBy("revision", "asc"),
    ]);
    return { tracks, videos, tasks, artifacts };
  });
  if (!tracks.length) return [];

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

      const trackTasks = tasks.filter((task) => task.videoTrackId === track.id);
      const latestTask = trackTasks.at(-1);
      const trackArtifacts = artifacts.filter((artifact) => artifact.videoTrackId === track.id);
      const latestArtifact = trackArtifacts.at(-1);
      const trackVideos = videos.filter((video) => video.videoTrackId === track.id);
      const selectedVideo = track.videoId
        ? trackVideos.find((video) => video.id === track.videoId)
        : undefined;
      if (track.videoId && !selectedVideo) {
        throw new Error(`Video ${track.videoId} 不属于 Video Track ${track.id}`);
      }
      const selectedArtifact = selectedVideo?.artifactRevisionId
        ? trackArtifacts.find((artifact) => artifact.id === selectedVideo.artifactRevisionId)
        : undefined;
      if (selectedVideo?.artifactRevisionId && !selectedArtifact) {
        throw new Error(`Artifact Revision ${selectedVideo.artifactRevisionId} 不属于 Video Track ${track.id}`);
      }
      if (selectedArtifact?.videoId && selectedArtifact.videoId !== selectedVideo?.id) {
        throw new Error(`Artifact Revision ${selectedArtifact.id} 不属于 Video ${selectedVideo?.id}`);
      }

      if (latestArtifact?.videoId && !trackVideos.some((video) => video.id === latestArtifact.videoId)) {
        throw new Error(`Artifact Revision ${latestArtifact.id} 的 Video ${latestArtifact.videoId} 不属于 Video Track ${track.id}`);
      }
      if (latestArtifact?.generationTaskId && !trackTasks.some((task) => task.id === latestArtifact.generationTaskId)) {
        throw new Error(
          `Artifact Revision ${latestArtifact.id} 的 Generation Task ${latestArtifact.generationTaskId} 不属于 Video Track ${track.id}`,
        );
      }
      for (const video of trackVideos) {
        if (video.generationTaskId && !trackTasks.some((task) => task.id === video.generationTaskId)) {
          throw new Error(`Video ${video.id} 的 Generation Task ${video.generationTaskId} 不属于 Video Track ${track.id}`);
        }
        const artifact = video.artifactRevisionId
          ? trackArtifacts.find((candidate) => candidate.id === video.artifactRevisionId)
          : undefined;
        if (video.artifactRevisionId && !artifact) {
          throw new Error(`Artifact Revision ${video.artifactRevisionId} 不属于 Video Track ${track.id}`);
        }
        if (artifact?.videoId && artifact.videoId !== video.id) {
          throw new Error(`Artifact Revision ${artifact.id} 不属于 Video ${video.id}`);
        }
      }

      let promptRevision = null;
      if (track.promptRevisionId) {
        const revision = await dependencies.db((db) =>
          db("o_promptRevision").where("id", track.promptRevisionId).first(),
        );
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

      const videoList = await Promise.all(
        trackVideos
          .map(async (video) => {
            const artifact = video.artifactRevisionId
              ? trackArtifacts.find((candidate) => candidate.id === video.artifactRevisionId)
              : undefined;
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
          inputRefs: projectedInputs,
          outputSelection: output,
          audioSelection: await resolveAudioSelection(dependencies, track, latestTask),
          promptRevisionId: track.promptRevisionId ?? null,
        },
        videoList,
      };
    }),
  );
}
