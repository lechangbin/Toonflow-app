import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    storyboardId: z.number(),
    videoId: z.number(),
  }),
  async (req, res) => {
    const { storyboardId, videoId } = req.body;
    await u.db("o_videoConfig").where("storyboardId", storyboardId).update({ videoId, updateTime: Date.now() });
    res.status(200).send(success({ message: "选择确认成功" }));
  },
);
