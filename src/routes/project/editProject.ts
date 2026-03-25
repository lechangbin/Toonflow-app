import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增项目
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string(),
    intro: z.string(),
    type: z.string(),
    artStyle: z.string(),
    videoRatio: z.string(),
    imageModel: z.string(),
    videoModel: z.string(),
  }),
  async (req, res) => {
    const { id, name, intro, type, artStyle, videoRatio, imageModel, videoModel } = req.body;

    await u.db("o_project").where("id", id).update({
      name,
      intro,
      type,
      artStyle,
      videoRatio,
      imageModel,
      videoModel,
    });

    res.status(200).send(success({ message: "新增项目成功" }));
  },
);
