import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import axios from "axios";
const router = express.Router();

async function urlToBase64(imageUrl: string): Promise<string> {
  const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
  const contentType = response.headers["content-type"] || "image/png";
  const base64 = Buffer.from(response.data, "binary").toString("base64");
  return `data:${contentType};base64,${base64}`;
}
export default router.post(
  "/",
  validateFields({
    model: z.string(),
    references: z.array(z.string()).optional(),
    quality: z.string(),
    ratio: z.string(),
    prompt: z.string(),
    projectId: z.number(),
    type: z.enum(["role", "scene", "storyboard", "clip", "tool"]),
  }),
  async (req, res) => {
    const { model, references = [], quality, ratio, prompt, projectId, type } = req.body;

    const imageClass = await u.Ai.Image(model).run({
      prompt: prompt,
      imageBase64: references && references.length ? await Promise.all(references.map((url: string) => urlToBase64(url))) : [],
      size: quality,
      aspectRatio: ratio,
      taskClass: "分镜生成",
      describe: "生成分镜图片",
      relatedObjects: JSON.stringify(req.body),
      projectId: projectId,
    });
    const savePath = `${projectId}/${type}/${u.uuid()}.jpg`;
    await imageClass.save(savePath);

    const url = await u.oss.getFileUrl(savePath);
    return res.status(200).send(success({ url }));
  },
);
