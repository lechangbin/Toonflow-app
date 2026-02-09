import "../type";
import axios from "axios";
import sharp from "sharp";
import FormData from "form-data";
import { pollTask, validateVideoConfig } from "@/utils/ai/utils";
import { createOpenAI } from "@ai-sdk/openai";
import { experimental_generateVideo as generateVideo } from "ai";
export default async (input: VideoConfig, config: AIConfig) => {
  if (!config.apiKey) throw new Error("缺少API Key");
  if (!config.baseURL) throw new Error("缺少baseURL");
  // const { owned, images, hasTextType } = validateVideoConfig(input, config);
  const [requestUrl, queryUrl] = config.baseURL.split("|");

  const authorization = `Bearer ${config.apiKey}`;

  const formData = new FormData();
  formData.append("model", config.model);
  formData.append("prompt", input.prompt);
  formData.append("seconds", String(input.duration));

  // 根据 aspectRatio 设置 size
  const sizeMap: Record<string, string> = {
    "16:9": "1280x720",
    "9:16": "720x1280",
  };
  formData.append("size", sizeMap[input.aspectRatio] || "1920x1080");
  
  if (input.imageBase64 && input.imageBase64.length) {
    const base64Data = input.imageBase64[0]!.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    formData.append("input_reference", buffer, { filename: "image.jpg", contentType: "image/jpeg" });
  }

  const body = {
    model: "sora-2-all",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: input.prompt,
          },
        ],
      },
    ],
  };
  const { data } = await axios.post(
    "https://api2.aigcbest.top/v1/chat/completions",
    { ...body },
    {
      headers: { "Content-Type": "application/json", Authorization: authorization },
    },
  );
  
  
  if (data.status === "FAILED") throw new Error(`任务提交失败: ${data.errorMessage || "未知错误"}`);
};
