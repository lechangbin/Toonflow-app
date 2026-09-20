import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getDefaultConfiguredVendor } from "@/vendor";
import { z } from "zod";
import { tool, jsonSchema } from "ai";
import { getDatabaseRuntime } from "@/database";
const router = express.Router();

// 检查语言模型
export default router.post(
  "/",
  validateFields({
    modelName: z.string(),
    id: z.string(),
    messages: z.array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    ),
  }),
  async (req, res) => {
    const { modelName, messages, id } = req.body;

    try {
      const vendorConfigData = await getDatabaseRuntime().work((db) => db("o_vendorConfig").where("id", id).first());

      if (!vendorConfigData) return res.status(500).send(error("未找到该供应商配置"));
      if (!vendorConfigData.models) return res.status(500).send(error("未找到模型列表"));

      const getWeatherTool = tool({
        description: "Get the weather in a location",
        inputSchema: jsonSchema<{ location: string }>(
          z
            .object({
              location: z.string().describe("The location to get the weather for"),
            })
            .toJSONSchema(),
        ),
        execute: async ({ location }) => {
          return {
            location,
            temperature: 72 + Math.floor(Math.random() * 21) - 10,
          };
        },
      });

      const data = await getDefaultConfiguredVendor().invokeText({
        target: { kind: "direct", vendorId: id, modelId: modelName },
        input: {
          messages,
          tools: { getWeatherTool },
        },
      });
      if (!data) return res.status(500).send(error("模型未返回结果"));
      res.status(200).send(success({ thinking: data.reasoningText, content: data.text }));
    } catch {
      res.status(500).send(error("模型测试失败"));
    }
  },
);
