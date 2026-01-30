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
    manufacturer: z.string(),
  }),
  async (req, res) => {
    const { modelName, apiKey, baseURL, manufacturer } = req.body;
    try {
      const contentStr = await u.ai.generateImage(
        {
          prompt: "2D cat",
          imageBase64: [],
          aspectRatio: "16:9",
          size: "1K",
        },
        {
          model: modelName,
          apiKey,
          baseURL,
          manufacturer,
        },
      );
      res.status(200).send(success(contentStr));
    } catch (err: any) {
      res.status(500).send(error(err.error.message || "模型调用失败"));
    }
  },
);
