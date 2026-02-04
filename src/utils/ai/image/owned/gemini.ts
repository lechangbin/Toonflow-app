import "../type";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateImage } from "ai";

export default async (input: ImageConfig, config: AIConfig): Promise<string> => {
  if (!config.model) throw new Error("缺少Model名称");
  if (!config.apiKey) throw new Error("缺少API Key");
  if (!input.prompt) throw new Error("缺少提示词");

  const google = createGoogleGenerativeAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  // 构建完整的提示词
  const fullPrompt = input.systemPrompt ? `${input.systemPrompt}\n\n${input.prompt}` : input.prompt;

  // 根据 size 配置映射到具体尺寸
  const sizeMap: Record<string, `${number}x${number}`> = {
    "1K": "1024x1024",
    "2K": "2048x2048",
    "4K": "4096x4096",
  };

  const { image } = await generateImage({
    model: google.image(config.model),
    prompt: fullPrompt,
    aspectRatio: input.aspectRatio as "1:1" | "3:4" | "4:3" | "9:16" | "16:9",
    size: sizeMap[input.size] ?? "1024x1024",
  });

  // 返回生成的图片 base64
  return image.base64;
};
