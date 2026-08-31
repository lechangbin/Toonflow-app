import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 编辑剧本
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string(),
    content: z.string(),
    assets: z.array(z.number()),
  }),
  async (req, res) => {
    const { id, name, content, assets } = req.body;
    await getDatabaseRuntime().work(async (db) => {
      await db("o_script").where({ id }).update({
        name,
        content,
      });
      if (assets.length) {
        const assetsData = await db("o_assets").whereIn("id", assets).select();
        await db("o_scriptAssets").where({ scriptId: id }).delete();
        if (assetsData.length) {
          const insertData = assetsData.map((item) => {
            return {
              scriptId: id,
              assetId: item.id,
            };
          });
          await db("o_scriptAssets").insert(insertData);
        }
      }
    });

    res.status(200).send(success({ message: "编辑剧本成功" }));
  },
);
