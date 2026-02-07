import "../type";
import { generateImage, generateText, ModelMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export default async (input: ImageConfig, config: AIConfig): Promise<string> => {
  if (!config.model) throw new Error("缺少Model名称");
  if (!config.apiKey) throw new Error("缺少API Key");
  if (!config.baseURL) throw new Error("缺少baseUrl");

  const apiKey = config.apiKey.replace("Bearer ", "");

  const otherProvider = createOpenAICompatible({
    name: "xixixi",
    baseURL: config.baseURL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  // 根据 size 配置映射到具体尺寸
  const sizeMap: Record<string, `${number}x${number}`> = {
    "1K": "1024x1024",
    "2K": "2048x2048",
    "4K": "4096x4096",
  };
  // 构建完整的提示词
  const fullPrompt = input.systemPrompt ? `${input.systemPrompt}\n\n${input.prompt}` : input.prompt;
  const model = config.model;
  if (model.includes("gemini") || model.includes("nano")) {
    let promptData;
    if (input.imageBase64 && input.imageBase64.length) {
      promptData = [{ role: "system", content: fullPrompt + `请直接输出图片` }];
      (promptData as ModelMessage[]).push({
        role: "user",
        content: input.imageBase64.map((i) => ({
          type: "image",
          image: i,
        })),
      });
    } else {
      promptData = fullPrompt + `请直接输出图片`;
    }
    console.log("%c Line:31 🍅 promptData", "background:#2eafb0", promptData);

    const result = await generateText({
      model: otherProvider.languageModel(model),
      prompt: promptData as string | ModelMessage[],
      providerOptions: {
        google: {
          imageConfig: {
            ...(config.model == "gemini-2.5-flash-image"
              ? { aspectRatio: input.aspectRatio }
              : { aspectRatio: input.aspectRatio, imageSize: input.size }),
          },
          responseModalities: ["IMAGE"],
        },
      },
    });
    if (result.files && result.files.length) {
      let imageBase64;
      for (const item of result.files) {
        imageBase64 = `data:${item.mediaType};base64,${item.base64}`;
      }
      // 返回生成的图片 base64
      return imageBase64!;
    } else {
      if (!result.text) {
        console.error(JSON.stringify(result.response, null, 2));
        throw new Error("图片生成失败");
      }
      const match = result.text.match(/base64,([A-Za-z0-9+/=]+)/);
      const base64Str = match && match[1] ? match[1] : result.text;

      // 返回生成的图片 base64
      return "data:image/jpeg;base64," + base64Str!;
    }
  } else {
    const { image } = await generateImage({
      model: otherProvider.imageModel(model),
      prompt:
        input.imageBase64 && input.imageBase64.length
          ? { text: fullPrompt + `请直接输出图片`, images: input.imageBase64 }
          : fullPrompt + `请直接输出图片`,
      aspectRatio: input.aspectRatio as "1:1" | "3:4" | "4:3" | "9:16" | "16:9",
      size: sizeMap[input.size] ?? "1024x1024",
    });

    return image.base64;
  }
};
