import express from "express";
import { success, error } from "@/lib/responseFormat";
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
    modelName: z.string(),
    apiKey: z.string(),
    baseURL: z.string().optional(),
  }),
  async (req, res) => {
    const { modelName, apiKey, baseURL } = req.body;
    const ai = new OpenAIChatModel({
      apiKey: apiKey,
      baseURL: baseURL,
      model: modelName,
      modelOptions: { temperature: 0.7 },
    });
    try {
      const data = await ai.invoke({
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      });
      res.status(200).send(success(data));
    } catch (err: any) {
      res.status(500).send(error(err.error.message || "模型调用失败"));
    }
  },
);
