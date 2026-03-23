import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    videoId: z.number(),
  }),
  async (req, res) => {
    const { videoId } = req.body;
    await u.db("o_video").where("id", videoId).delete();
    await u.db("o_videoConfig").where("videoId", videoId).update({ videoId: null, updateTime: Date.now() });
    res.status(200).send(success({ message: "视频删除成功" }));
  },
);
