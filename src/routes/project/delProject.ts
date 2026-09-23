import express from "express";
import u from "@/utils";
import { getDatabaseRuntime, type DatabaseWork } from "@/database";
import { deleteProjectAgentEvidence } from "@/agentRuntime/retention";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
export function createDeleteProjectRouter(dependencies: {
  work: DatabaseWork;
  deleteDirectory(path: string): Promise<void>;
}) {
const router = express.Router();

// 删除项目
router.post(
  "/",
  validateFields({
    id: z.number().int().positive(),
  }),
  async (req, res) => {
    const { id } = req.body;
    const actorUserId = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
    if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
      res.status(403).send({ message: "操作人身份无效" }); return;
    }
    // Project and its Agent evidence graph must disappear together or not at all.
    const deleted = await dependencies.work((db) => db.transaction(async (tx) => {
      const changed = await tx("o_project").where({ id, userId: actorUserId }).delete();
      if (changed !== 1) return false;
      await deleteProjectAgentEvidence(tx, id);
      await tx("o_agentWorkData").where("projectId", id).delete();
      //删除项目下的原文
      await tx("o_novel").where("projectId", id).delete();
      // 删除项目下的剧本信息
      const scriptData = await tx("o_script").where("projectId", id).select("id");
      const scriptIds = scriptData.map((item: any) => item.id);
      if (scriptIds && scriptIds.length > 0) {
        await tx("o_scriptAssets").whereIn("scriptId", scriptIds).delete();
      }
      await tx("o_script").where("projectId", id).delete();
      // 删除项目下的任务
      await tx("o_tasks").where("projectId", id).delete();
      // 删除项目下的分镜
      const storyboardData = await tx("o_storyboard").where("projectId", id).select("id");
      const storyboardIds = storyboardData.map((item: any) => item.id);
      if (storyboardIds.length > 0) {
        await tx("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).delete();
      }
      await tx("o_storyboard").where("projectId", id).delete();
      //删除需要删除资产的归属图片
      const assetsData = await tx("o_assets").where("projectId", id).select("id");
      const assetsIds = assetsData.map((item: any) => item.id);
      if (assetsIds && assetsIds.length > 0) {
        // 先将 o_assets.imageId 置空，解除对 o_image 的外键引用
        await tx("o_assets").whereIn("id", assetsIds).update({ imageId: null });
        await tx("o_image").whereIn("assetsId", assetsIds).delete();
      }
      // 删除项目下的资产
      await tx("o_assets").where("projectId", id).delete();
      //删除项目下的视频轨道和视频
      await tx("o_videoTrack").where("projectId", id).delete();
      await tx("o_video").where("projectId", id).delete();
      //删除项目下的资源

      await tx("memories").where("isolationKey", "like", `${id}:%`).delete();
      return true;
    }));
    if (!deleted) { res.status(404).send({ message: "项目不存在" }); return; }

    let mediaCleanup: "deleted" | "missing" | "failed" = "deleted";
    try {
      await dependencies.deleteDirectory(`${id}/`);
    } catch (error: unknown) {
      mediaCleanup = (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "failed";
    }

    res.status(200).send(success({ message: mediaCleanup === "failed"
      ? "项目数据库记录已删除，本地媒体清理失败，请人工核对" : "删除项目成功", mediaCleanup }));
  },
);
return router;
}

export default createDeleteProjectRouter({
  work: (operation) => getDatabaseRuntime().work(operation),
  deleteDirectory: (path) => u.oss.deleteDirectory(path),
});
