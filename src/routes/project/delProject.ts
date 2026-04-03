import express from "express";
import u from "@/utils";
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
    //删除项目
    await u.db("o_project").where("id", id).delete();
    //删除项目下的原文
    await u.db("o_novel").where("projectId", id).delete();
    // 删除项目下的剧本信息
    await u.db("o_script").where("projectId", id).delete();
    await u.db("o_outline").where("projectId", id).delete();
    // 删除项目下的任务
    await u.db("o_tasks").where("projectId", id).delete();
    // 删除项目下的分镜
    await u.db("o_storyboard").where("projectId", id).delete();
    // 删除项目下的资产
    await u.db("o_assets").where("projectId", id).delete();
    //删除需要删除资产的归属图片
    const assetsData = await u.db("o_assets").where("projectId", id).select("id");
    const assetsIds = assetsData.map((item: any) => item.id);
    if (assetsIds.length > 0) {
      await u.db("o_image").orWhereIn("assetsId", assetsIds).delete();
    }
    //删除项目下的视频
    const videoData = await u.db("o_video").where("projectId", id).select("id");
    const videoIds = videoData.map((item: any) => item.id);
    if (videoIds.length > 0) {
      await u.db("o_videoTrack").whereIn("videoId", videoIds).update({
        videoId: null,
      });
    }
    await u.db("o_video").where("projectId", id).delete();
    //删除项目下的资源
    try {
      await u.oss.deleteDirectory(`${id}/`);
      console.log(`项目 ${id} 的OSS文件夹删除成功`);
    } catch (error: any) {
      console.log(`项目 ${id} 没有对应的OSS文件夹，跳过删除`);
    }

    res.status(200).send(success({ message: "删除项目成功" }));
  },
);
