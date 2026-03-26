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
  res.status(200).send(success(data));
});
