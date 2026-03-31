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
}

interface TrackItem {
  id?: number;
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
    // const data = await u.db("o_videoTrack").where({ projectId, scriptId });
    const storyboardList = await u.db("o_storyboard").where({ scriptId }).orderBy("index", "asc");
    console.log("%c Line:17 🥝 storyboardList", "background:#ea7e5c", storyboardList);
    // const data = await u.db("o_video").where({ projectId, scriptId });
    const trackList: TrackItem[] = [
      {
        id: 1,
        medias: [{ src: "https://example.com/image1.jpg", fileType: "image", id: 1 }],
        videoList: [
          { id: 1, src: "https://example.com/video1.mp4", state: "已完成" },
          { id: 2, src: "https://example.com/video2.mp4", state: "生成中" },
        ],
      },
    ];

    res.status(200).send(success(trackList));
  },
);
