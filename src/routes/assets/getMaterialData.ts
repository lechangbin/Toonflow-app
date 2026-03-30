import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 获取生成图片
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
  }),
  async (req, res) => {
    const { projectId } = req.body;
    const list = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.id", "=", "o_image.assetsId")
      .where("o_assets.type", "clip")
      .andWhere("projectId", projectId)
      .select("*");
    const data = await Promise.all(
      list.map(async (item) => ({
        ...item,
        filePath: item.filePath ? await u.oss.getFileUrl(item.filePath) : "",
      })),
    );
    //拿到本地片尾视频并插入到data中
    const ending = await u.oss.getFileUrl("/ending/1d7a2dfdd0c057823797fdf97677a7a0.mp4");
    data.push({
      id: 0,
      name: "片尾",
      filePath: ending,
      type: "clip",
    });
    // 查询o_videoConfig表，拿到已选中的videoId
    const configRows = await u.db("o_videoConfig").select("videoId");
    const selectedIds = new Set(configRows.map((row) => row.videoId));

    // 查询o_video表
    const videoRows = await u.db("o_video").where("state", "生成成功").andWhere("projectId", projectId).select("*");
    // 处理并返回结果
    const video = await Promise.all(
      videoRows.map(async (row) => ({
        id: row.id,
        filePath: row.filePath ? await u.oss.getFileUrl(row.filePath) : "",
        selected: selectedIds.has(row.id),
        videoParametersId: row.videoParametersId,
      })),
    );

    res.status(200).send(success({ data, video }));
  },
);
