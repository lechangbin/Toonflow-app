import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    ids: z.array(z.number()),
  }),
  async (req, res) => {
    const { ids } = req.body;

    //查询分镜配置
    const storyboardConfigs = await u.db("o_videoConfig").whereIn("storyboardId", ids).select("*");

    //查询视频数据
    const videos = await u.db("o_video").whereIn("storyboardId", ids).select("*");

    //组装数据
    const data = await Promise.all(
      ids.map(async (storyboardId: number) => {
        // 处理配置
        const configRow = storyboardConfigs.find((item) => item.storyboardId === storyboardId) || null;
        let config = null;
        if (configRow?.data) {
          const parsedData = JSON.parse(configRow.data);
          const dataWithFilePath = await Promise.all(
            parsedData.map(async (d: { type: string; id: number }) => {
              if (d.type === "assets" && d.id) {
                const row = await u
                  .db("o_assets")
                  .where("o_assets.id", d.id)
                  .leftJoin("o_image", "o_assets.imageId", "o_image.id")
                  .select("o_image.filePath as imageFilePath")
                  .first();
                if (row?.imageFilePath) {
                  return { id: d.id, type: "assets", url: await u.oss.getFileUrl(row.imageFilePath) };
                }
                return null;
              }
              if (d.type === "storyboard" && d.id) {
                const row = await u.db("o_storyboard").where("id", d.id).select("filePath").first();
                if (row?.filePath) {
                  return { id: d.id, type: "storyboard", url: await u.oss.getFileUrl(row.filePath) };
                }
                return null;
              }
              return null;
            }),
          );
          config = { ...configRow, data: dataWithFilePath };
        }

        // 处理视频
        const storyboardVideos = videos.filter((v) => v.storyboardId === storyboardId);
        const videosList = await Promise.all(
          storyboardVideos.map(async (item) => ({
            ...item,
            filePath: item.filePath ? await u.oss.getFileUrl(item.filePath) : null,
          })),
        );

        return {
          id: storyboardId,
          config,
          videos: videosList,
        };
      }),
    );
    return res.status(200).send(success(data));
  },
);
