import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

interface VideoItem {
  id: number;
  src: string;
  state: "未生成" | "生成中" | "已完成" | "生成失败";
}

interface TrackMedia {
  src: string;
  id?: number;
  fileType: "image" | "video" | "audio";
  prompt?: string;
}

interface TrackItem {
  id?: number;
  prompt: string;
  state: "未生成" | "生成中" | "已完成" | "生成失败";
  reason?: string;
  medias: TrackMedia[];
  videoList: VideoItem[];
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
  }),
  async (req, res) => {
    const { projectId, scriptId } = req.body;
    const storyboardList = await u.db("o_storyboard").where({ scriptId, projectId }).orderBy("index", "asc");
    const videoList = await u.db("o_video").whereIn(
      "videoTrackId",
      storyboardList.map((s) => s.trackId),
    );
      console.log("%c Line:40 🌽 videoList", "background:#ffdd4d", videoList);
    const trackData = await u.db("o_videoTrack").whereIn(
      //@ts-ignore
      "id",
      storyboardList.map((s) => s.trackId),
    );

    const trackList: TrackItem[] = [];
    const trackIdMap = [...new Set<number>(storyboardList.map((s) => s.trackId!))];
    for (const trackId of trackIdMap) {
      const item = trackData.find((t) => t.id === trackId);
      trackList.push({
        id: trackId,
        prompt: item?.prompt || "",
        state: (item?.state as "未生成" | "生成中" | "已完成" | "生成失败") ?? "未生成",
        reason: item?.reason ?? "",
        medias: await Promise.all(
          storyboardList
            .filter((s) => s.trackId === trackId)
            .map(async (s): Promise<TrackMedia> => ({
              src: s.filePath ? await u.oss.getFileUrl(s.filePath) : "",
              fileType: "image",
              ...(s.prompt != null ? { prompt: s.prompt } : {}),
              ...(s.id != null ? { id: s.id } : {}),
            })),
        ),
        videoList: await Promise.all(
          videoList
            .filter((v) => v.videoTrackId === trackId)
            .map(async (v) => ({
              id: v.id!,
              src: v.filePath ? await u.oss.getFileUrl(v.filePath) : "",
              state: v.state === "done" ? "已完成" : v.state === "generating" ? "生成中" : v.state === "error" ? "生成失败" : "未生成",
            })),
        ),
      });
    }

    res.status(200).send(
      success({
        storyboardList: await Promise.all(
          storyboardList.map(async (s) => ({
            ...s,
            src: s.filePath ? await u.oss.getFileUrl(s.filePath) : "",
          })),
        ),
        trackList,
      }),
    );
  },
);
