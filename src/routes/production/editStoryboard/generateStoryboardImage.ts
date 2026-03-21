import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    model: z.string(),
    references: z.array(z.string()).optional(),
    quality: z.string(),
    ratio: z.string(),
    prompt: z.string(),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { model, references = [], quality, ratio, prompt, projectId } = req.body;
    const imageClass = await u.Ai.Image(model).run({
      prompt: prompt,
      imageBase64: references,
      size: quality,
      aspectRatio: ratio,
      taskClass: "分镜生成",
      describe: "生成分镜图片",
      relatedObjects: JSON.stringify(req.body),
      projectId: projectId,
    });
    const savePath = `${projectId}/storyboard/${u.uuid()}.jpg`;
    await imageClass.save(savePath);

    const url = await u.oss.getFileUrl(savePath);
    const [imageId] = await u.db("o_image").insert({
      filePath: savePath,
      state: "1",
      type: "storyFlow",
    });
    return res.status(200).send(success({ imageId, url }));
  },
);
