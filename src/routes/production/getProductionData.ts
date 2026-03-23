import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    scriptId: z.number(),
  }),
  async (req, res) => {
    const { scriptId } = req.body;

    // 1. 查出该剧本下所有分镜
    const storyboards = await u.db("o_storyboard").where("o_storyboard.scriptId", scriptId).select("*").orderBy("o_storyboard.createTime", "asc");

    if (storyboards.length === 0) {
      return res.status(200).send(success([]));
    }

    const storyboardIds = storyboards.map((s) => s.id as number);

    // 2. 批量查出所有相关视频
    const videos = await u
      .db("o_video")
      .whereIn("o_video.storyboardId", storyboardIds)
      .select("o_video.id", "o_video.storyboardId", "o_video.filePath", "o_video.state", "o_video.errorReason")
      .orderBy("o_video.time", "desc");

    // 3. 批量查出所有相关配置
    const configs = await u
      .db("o_videoConfig")
      .whereIn("o_videoConfig.storyboardId", storyboardIds)
      .select(
        "o_videoConfig.id",
        "o_videoConfig.storyboardId",
        "o_videoConfig.videoId",
        "o_videoConfig.prompt",
        "o_videoConfig.model",
        "o_videoConfig.mode",
        "o_videoConfig.resolution",
        "o_videoConfig.duration",
        "o_videoConfig.audio",
        "o_videoConfig.data",
      );

    // 4. 按 storyboardId 建立 Map 方便聚合
    const videoMap = new Map<number, typeof videos>();
    for (const video of videos) {
      const sid = video.storyboardId as number;
      if (!videoMap.has(sid)) videoMap.set(sid, []);
      videoMap.get(sid)!.push(video);
    }
    const configMap = new Map(configs.map((c) => [c.storyboardId as number, c]));

    // 5. 组装结果：分镜平铺 + config 对象 + videos 数组
    const data = await Promise.all(
      storyboards.map(async (storyboard) => {
        const sid = storyboard.id as number;
        const config = configMap.get(sid) ?? null;
        let configDataWithFilePath: any[] = [];
        if (config?.data) {
          const parsedData: { id: number; type: string }[] = JSON.parse(config.data);
          configDataWithFilePath = await Promise.all(
            parsedData.map(async (item) => {
              if (item.type === "storyboard") {
                const row = await u.db("o_storyboard").where("id", item.id).select("filePath").first();
                return row?.filePath ? await u.oss.getFileUrl(row.filePath) : null;
              }
              if (item.type === "assets") {
                const row = await u
                  .db("o_assets")
                  .where("o_assets.id", item.id)
                  .leftJoin("o_image", "o_assets.imageId", "o_image.id")
                  .select("o_image.filePath")
                  .first();
                return row?.filePath ? await u.oss.getFileUrl(row.filePath) : null;
              }
              return null;
            }),
          );
        }
        return {
          ...storyboard,
          filePath: storyboard.filePath && (await u.oss.getFileUrl(storyboard.filePath!)),
          config: config ? { ...config, data: configDataWithFilePath } : null,
          videos: await Promise.all(
            (videoMap.get(sid) ?? []).map(async (video) => ({
              ...video,
              filePath: video.filePath ? await u.oss.getFileUrl(video.filePath) : null,
            })),
          ),
        };
      }),
    );

    return res.status(200).send(success(data));
  },
);
