import "../type";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

export default async (input: ImageConfig, config: AIConfig): Promise<string> => {
  console.log("%c Line:6 🌰 config", "background:#ffdd4d", config);
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

  const result = await generateText({
    model: google.languageModel(config.model),
    prompt: fullPrompt + `请直接输出图片`,
    providerOptions: {
      google: {
        imageConfig: {
          ...(config.model == "gemini-2.5-flash-image"
            ? { aspectRatio: input.aspectRatio }
            : { aspectRatio: input.aspectRatio, imageSize: input.size }),
        },
      },
    },
  });

  console.log(JSON.stringify(result.request, null, 2));
  console.log(JSON.stringify(result.response.body, null, 2));
  if (!result.files.length) {
    console.error(JSON.stringify(result.response, null, 2));
    throw new Error("图片生成失败");
  }
  let imageBase64;
  for (const item of result.files) {
    imageBase64 = `data:${item.mediaType};base64,${item.base64}`;
  }
  // 返回生成的图片 base64
  return imageBase64!;
};
