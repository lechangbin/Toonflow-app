import express from "express";
import u from "@/utils";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 删除项目
export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    // 删除项目及其关联数据共享一个 lease，保证语义连续。
    await getDatabaseRuntime().work(async (db) => {
      //删除项目
      await db("o_project").where("id", id).delete();
      await db("o_agentWorkData").where("projectId", id).delete();
      //删除项目下的原文
      await db("o_novel").where("projectId", id).delete();
      // 删除项目下的剧本信息
      const scriptData = await db("o_script").where("projectId", id).select("id");
      const scriptIds = scriptData.map((item: any) => item.id);
      if (scriptIds && scriptIds.length > 0) {
        await db("o_scriptAssets").whereIn("scriptId", scriptIds).delete();
      }
      await db("o_script").where("projectId", id).delete();
      // 删除项目下的任务
      await db("o_tasks").where("projectId", id).delete();
      // 删除项目下的分镜
      const storyboardData = await db("o_storyboard").where("projectId", id).select("id");
      const storyboardIds = storyboardData.map((item: any) => item.id);
      if (storyboardIds.length > 0) {
        await db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).delete();
      }
      await db("o_storyboard").where("projectId", id).delete();
      //删除需要删除资产的归属图片
      const assetsData = await db("o_assets").where("projectId", id).select("id");
      const assetsIds = assetsData.map((item: any) => item.id);
      if (assetsIds && assetsIds.length > 0) {
        // 先将 o_assets.imageId 置空，解除对 o_image 的外键引用
        await db("o_assets").whereIn("id", assetsIds).update({ imageId: null });
        await db("o_image").whereIn("assetsId", assetsIds).delete();
      }
      // 删除项目下的资产
      await db("o_assets").where("projectId", id).delete();
      //删除项目下的视频轨道和视频
      await db("o_videoTrack").where("projectId", id).delete();
      await db("o_video").where("projectId", id).delete();
      //删除项目下的资源

      await db("memories").where("isolationKey", "like", `${id}:%`).delete();
    });

    try {
      await u.oss.deleteDirectory(`${id}/`);
      console.log(`项目 ${id} 的OSS文件夹删除成功`);
    } catch (error: any) {
      console.log(`项目 ${id} 没有对应的OSS文件夹，跳过删除`);
    }

    res.status(200).send(success({ message: "删除项目成功" }));
  },
);
