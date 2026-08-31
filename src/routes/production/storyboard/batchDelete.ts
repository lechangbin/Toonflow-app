import express from "express";
import { z } from "zod";
import { getDatabaseRuntime } from "@/database";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    ids: z.array(z.number()),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { ids, projectId } = req.body;
    if (!ids.length) return res.status(400).send(error("请先选择分镜"));
    const storyboardDataList = await getDatabaseRuntime().work((db) =>
      db("o_storyboard").whereIn("id", ids).where("projectId", projectId).select("id", "track", "trackId", "flowId"),
    );
    if (!storyboardDataList.length) return res.status(400).send(error("当前选择分镜不存在"));
    const flowIds = storyboardDataList.map((i) => i.flowId);
    const storyBoardIds = storyboardDataList.map((i) => i.id);
    if (flowIds.length) {
      await getDatabaseRuntime().work((db) => db("o_imageFlow").whereIn("id", flowIds as number[]).delete());
    }

    await getDatabaseRuntime().work((db) => db("o_storyboard").whereIn("id", storyBoardIds).delete());
    await getDatabaseRuntime().work((db) => db("o_assets2Storyboard").whereIn("storyboardId", storyBoardIds).delete());
    res.status(200).send(success({ message: "视频删除成功" }));
  },
);
