import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 获取项目概览统计
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
  }),
  async (req, res) => {
    const { projectId } = req.body;

    const data = await getDatabaseRuntime().work(async (db) => {
      const scripts = await db("o_script").where("projectId", projectId).select("id");
      const scriptIds = scripts.map((item: any) => item.id);

      const roleCount: any = await db("o_assets").where("projectId", projectId).where("type", "角色").count("* as total").first();
      const scriptCount: any = await db("o_script").where("projectId", projectId).count("* as total").first();
      const videoCount: any = await db("o_video").whereIn("scriptId", scriptIds).count("* as total").first();
      const storyboardCount: any = await db("o_assets").whereIn("scriptId", scriptIds).where("type", "分镜").count("* as total").first();

      return {
        roleCount: roleCount?.total || 0,
        scriptCount: scriptCount?.total || 0,
        videoCount: videoCount?.total || 0,
        storyboardCount: storyboardCount?.total || 0,
      };
    });

    res.status(200).send(success(data));
  },
);
