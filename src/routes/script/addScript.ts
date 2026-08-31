import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增剧本
export default router.post(
  "/",
  validateFields({
    name: z.string(),
    content: z.string(),
    projectId: z.number(),
    assets: z.array(z.number()),
  }),
  async (req, res) => {
    const { name, content, projectId, assets } = req.body;
    await getDatabaseRuntime().work(async (db) => {
      const [scriptId] = await db("o_script").insert({
        name,
        content,
        projectId,
        createTime: Date.now(),
      });
      if (assets.length) {
        const assetsData = await db("o_assets").whereIn("id", assets).select();
        if (assetsData.length) {
          const assetsIds = assetsData.map((item) => item.id);
          const insertData = assetsIds.map((i) => {
            return {
              scriptId,
              assetId: i,
            };
          });
          await db("o_scriptAssets").insert(insertData);
        }
      }
    });

    res.status(200).send(success({ message: "添加剧本成功" }));
  },
);
