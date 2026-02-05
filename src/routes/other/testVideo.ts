import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { createAgent } from "langchain";
import { openAI } from "@/agents/models";
import { OpenAIChatModel, type OpenAIChatModelOptions } from "@aigne/openai";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
const router = express.Router();

// 检查语言模型
export default router.post(
  "/",
  validateFields({
    modelName: z.string().optional(),
    apiKey: z.string(),
    baseURL: z.string().optional(),
    manufacturer: z.enum(["runninghub", "volcengine", "apimart", "gemini", "openAi"]),
  }),
  async (req, res) => {
    const { modelName, apiKey, baseURL, manufacturer } = req.body;
    try {
      const videoPath = await u.ai.video({
        imageBase64: [],
        savePath: "test.mp4",
        prompt: "stickman Dances",
        duration: 4,
        resolution: "480p",
        aspectRatio: "16:9",
        audio: false,
      });
      const url = await u.oss.getFileUrl(videoPath);
      res.status(200).send(success(url));
    } catch (err: any) {
      const msg = u.error(err).message;
      console.error(msg);
      res.status(500).send(error(msg));
    }
  },
);
