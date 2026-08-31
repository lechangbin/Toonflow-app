import express from "express";
import { z } from "zod";

import type { DatabaseWork } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { resolveVideoReferenceMediaType } from "@/lib/videoPromptReferences";
import { readVideoTrackProjections } from "@/video/workbenchReadModel";

export interface GenerateDataRouteDependencies {
  db: DatabaseWork;
  getVendorModels(vendorId: string): Promise<readonly unknown[]>;
  getFileUrl(filePath: string): Promise<string>;
  getSmallImageUrl(filePath: string): Promise<string>;
}

interface VideoItem {
  id: number;
  src: string;
  state: "未生成" | "生成中" | "已完成" | "生成失败";
}

interface TrackMedia {
  src: string;
  id?: number;
  fileType: "image" | "video" | "audio";
  videoDesc?: string;
}

interface TrackItem {
  id?: number;
  prompt: string;
  state: "未生成" | "生成中" | "已完成" | "生成失败";
  reason?: string;
  duration?: number;
  selectVideoId?: number;
  medias: TrackMedia[];
  videoList: VideoItem[];
}

export function createGetGenerateDataRouter(dependencies: GenerateDataRouteDependencies) {
  const router = express.Router();

  return router.post(
    "/",
    validateFields({
      projectId: z.number(),
      scriptId: z.number(),
    }),
    async (req, res) => {
      const { projectId, scriptId } = req.body;
      const projectData = await dependencies.db((db) =>
        db("o_project")
          .where("id", projectId)
          .select("id", "videoVendorId", "videoModelId", "videoCapabilityId", "videoOutputPresetId", "videoRatio")
          .first(),
      );

      const projectDefaults =
        projectData?.videoVendorId && projectData.videoModelId && projectData.videoCapabilityId
          ? {
              vendorId: projectData.videoVendorId,
              modelId: projectData.videoModelId,
              capabilityId: projectData.videoCapabilityId,
              outputPresetId: projectData.videoOutputPresetId,
              aspectRatio: projectData.videoRatio,
            }
          : null;

      const trackProjections = await readVideoTrackProjections(
        {
          db: dependencies.db,
          getVendorModels: dependencies.getVendorModels,
          getFileUrl: dependencies.getFileUrl,
        },
        { projectId, scriptId },
      );
      const acceptsImageInputs =
        (projectData?.videoCapabilityId != null && projectData.videoCapabilityId !== "text-to-video") ||
        trackProjections.some((track) => track.actual.capabilityId && track.actual.capabilityId !== "text-to-video");

      const storyboardList = await dependencies.db((db) =>
        db("o_storyboard").where({ scriptId, projectId }).orderBy("index", "asc"),
      );
      await Promise.all(
        storyboardList.map(async (i) => {
          i.filePath = i.filePath ? await dependencies.getSmallImageUrl(i.filePath) : "";
        }),
      );
      const storyboardTrackRecord: Record<number, any[]> = {};
      storyboardList.forEach((i) => {
        if (storyboardTrackRecord[i.trackId!]) {
          storyboardTrackRecord[i.trackId!].push({
            src: i.filePath,
            fileType: "image",
            sources: "storyboard",
            ...(i.prompt != null ? { prompt: i.videoDesc } : {}),
            ...(i.id != null ? { id: i.id } : {}),
            index: i.index,
          });
        } else {
          storyboardTrackRecord[i.trackId!] = [
            {
              src: i.filePath,
              fileType: "image",
              sources: "storyboard",
              ...(i.prompt != null ? { prompt: i.videoDesc } : {}),
              ...(i.id != null ? { id: i.id } : {}),
              index: i.index,
            },
          ];
        }
      });
      // 按 storyboardId 分组的资产数据，key 为 storyboardId
      const otherDataMap: Record<number, any[]> = {};
      if (acceptsImageInputs) {
        const storyIds = storyboardList.map((s) => s.id);

        const assetDatas = await dependencies.db((db) =>
          db("o_assets2Storyboard")
            .leftJoin("o_assets", "o_assets2Storyboard.assetId", "o_assets.id")
            .leftJoin("o_image", "o_image.id", "o_assets.imageId")
            .whereIn("o_assets2Storyboard.storyboardId", storyIds as number[])
            .select("o_assets.*", "o_image.filePath", "o_image.type as storedFileType", "o_assets2Storyboard.storyboardId"),
        );

        const queryAudioIds = [...assetDatas.map((i) => i.id!), ...assetDatas.map((i) => i.assetsId!)].filter(Boolean);
        const assets2AudioData = await dependencies.db((db) =>
          db("o_assetsRole2Audio")
            .leftJoin("o_assets", "o_assets.assetsId", "o_assetsRole2Audio.assetsAudioId")
            .leftJoin("o_image", "o_image.id", "o_assets.imageId")
            .whereIn("o_assetsRole2Audio.assetsRoleId", queryAudioIds)
            .select(
              "o_assets.id",
              "o_assets.name",
              "o_assetsRole2Audio.assetsRoleId",
              "o_assets.describe",
              "o_assets.type",
              "o_assets.prompt",
              "o_image.filePath",
            ),
        );
        const audioRecord: Record<string, any> = {};
        await Promise.all(
          assets2AudioData.map(async (i) => {
            if (!audioRecord[i.assetsRoleId]) audioRecord[i.assetsRoleId] = [];
            audioRecord[i.assetsRoleId].push({
              id: i.id,
              name: i.name,
              describe: i.describe,
              type: i.type,
              fileType: "audio" as const,
              sources: "assets",
              prompt: i.prompt,
              src: i.filePath ? await dependencies.getFileUrl(i.filePath) : "",
            });
          }),
        );

        await Promise.all(
          assetDatas.map(async (i) => {
            const item = {
              id: i.id,
              name: i.name,
              describe: i.describe,
              type: i.type,
              fileType: resolveVideoReferenceMediaType(i.storedFileType, i.type, i.filePath),
              sources: "assets",
              src: i.filePath ? await dependencies.getSmallImageUrl(i.filePath) : "",
            };
            const sid = i.storyboardId as number;
            if (!otherDataMap[sid]) otherDataMap[sid] = [];
            otherDataMap[sid].push(item);
            if (audioRecord[i.id]) otherDataMap[sid].push(...audioRecord[i.id]);
            if (audioRecord[i.assetsId]) otherDataMap[sid].push(...audioRecord[i.assetsId]);
          }),
        );
      }

      const trackList: TrackItem[] = [];
      for (const projection of trackProjections) {
        const trackId = projection.id;
        trackList.push({
          ...projection,
          medias: (() => {
            const storyboardMedias = storyboardTrackRecord[trackId] ?? [];
            const assetMedias = storyboardMedias.flatMap((s) => otherDataMap[s.id] ?? []);

            const seenAssetIds = new Set<number>();
            const uniqueAssets = assetMedias.filter((a) => {
              if (seenAssetIds.has(a.id)) return false;
              seenAssetIds.add(a.id);
              return true;
            });

            const filteredAssets = uniqueAssets.filter((asset) => asset.fileType === "image");

            const hasImageAssetData = filteredAssets.filter((i) => i.src);
            const notHasImageAssetData = filteredAssets.filter((i) => !i.src);

            return [...hasImageAssetData, ...storyboardMedias, ...notHasImageAssetData];
          })(),
        });
      }
      res.status(200).send(
        success({
          projectDefaults,
          storyboardList: await Promise.all(
            storyboardList.map(async (s) => ({
              ...s,
              src: s.filePath,
            })),
          ),
          trackList,
        }),
      );
    },
  );
}
