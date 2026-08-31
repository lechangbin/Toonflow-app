import express from "express";
import { z } from "zod";
import { getDatabaseRuntime } from "@/database";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    const storyboardData = await getDatabaseRuntime().work((db) =>
      db("o_storyboard").where("id", id).select("id", "track", "trackId", "flowId").first(),
    );
    if (!storyboardData) return res.status(400).send(error("未找到该分镜"));
    if (storyboardData?.flowId) {
      await getDatabaseRuntime().work((db) => db("o_imageFlow").where("id", storyboardData?.flowId).delete());
    }
    const trackData = await getDatabaseRuntime().work((db) => db("o_storyboard").where("track", storyboardData.track).select("id"));
    if (trackData.length == 1) {
      await getDatabaseRuntime().work((db) => db("o_videoTrack").where("id", storyboardData.trackId).delete());
    }
    await getDatabaseRuntime().work((db) => db("o_storyboard").where("id", id).delete());
    await getDatabaseRuntime().work((db) => db("o_assets2Storyboard").where("storyboardId", id).delete());
    res.status(200).send(success({ message: "视频删除成功" }));
  },
);
