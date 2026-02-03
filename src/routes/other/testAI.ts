import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { generateText, Output, tool, stepCountIs } from "ai";
const router = express.Router();

import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";

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

    const getWeatherTool = tool({
      // strict: true,
      description: "Get the weather in a location",
      inputSchema: z.object({
        location: z.string().describe("The location to get the weather for"),
      }),
      execute: async ({ location }) => {
        return {
          location,
          temperature: 72 + Math.floor(Math.random() * 21) - 10,
        };
      },
    });
    try {
      const { reply } = await u.ai.text.invoke(
        {
          prompt: "请调用工具获取北京的天气，并回答我多少气温",
          tools: { getWeatherTool },
          output: {
            reply: z.string().describe("回复内容"),
          },
        },
        {
          model: modelName,
          apiKey,
          baseURL,
        },
      );
      console.log("%c Line:52 🍐 reply", "background:#ffdd4d", reply);
      res.status(200).send(success(reply));
    } catch (err) {
      console.log(err);
      if (typeof err === "string") return res.status(500).send(error(err));
      const msg = err instanceof Error ? err.message : (err as any)?.error?.message;
      return res.status(500).send(error(msg || "未知错误"));
    }
  },
);
