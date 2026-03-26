import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
const router = express.Router();

// 获取生成图片
export default router.post("/", async (req, res) => {
  const list = await u.db("o_assets").leftJoin("o_image", "o_assets.id", "=", "o_image.assetsId").where("o_assets.type", "clip").select("*");
  const data = await Promise.all(
    list.map(async (item) => ({
      ...item,
      filePath: item.filePath ? await u.oss.getFileUrl(item.filePath) : "",
    })),
  );
  // 查询o_videoConfig表，拿到已选中的videoId
  const configRows = await u.db("o_videoConfig").select("videoId");
  const selectedIds = new Set(configRows.map((row) => row.videoId));

  // 查询o_video表
  const videoRows = await u.db("o_video").where("state", "生成成功").select("*");

  // 处理并返回结果
  const video = await Promise.all(
    videoRows.map(async (row) => ({
      id: row.id,
      filePath: row.filePath ? await u.oss.getFileUrl(row.filePath) : "",
      selected: selectedIds.has(row.id),
      storyboard: row.storyboardId,
    })),
  );
  res.status(200).send(success({ data, video }));
});
