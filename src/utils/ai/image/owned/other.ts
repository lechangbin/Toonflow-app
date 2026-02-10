import "../type";
import { generateImage, generateText, ModelMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import axios from "axios";

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
    console.log("%c Line:46 🍌 result", "background:#ea7e5c", result);

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
      const mdMatch = result.text.match(/^!\[.*?\]\((.+?)\)$/);
      if (mdMatch) {
        console.log("%c Line:75 🍎", "background:#42b983");
        const imgInfo = mdMatch[1];
        const base64InMd = imgInfo.match(/data:image\/[a-z]+;base64,(.+)/);
        if (base64InMd) {
          console.log("%c Line:79 🌮", "background:#ffdd4d");
          return imgInfo;
        } else {
          console.log("%c Line:82 🧀", "background:#33a5ff");
          return await urlToBase64(imgInfo);
        }
      }
      const base64Match = result.text.match(/base64,([A-Za-z0-9+/=]+)/);
      console.log("%c Line:87 🍆 base64Match", "background:#2eafb0", base64Match);
      if (base64Match) {
        return "data:image/jpeg;base64," + base64Match[1];
      }
      // 检查是否为图片直链 url
      if (/^https?:\/\/.*\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(result.text)) {
        console.log("%c Line:93 🍪", "background:#93c0a4");
        return await urlToBase64(result.text);
      }
      console.log("%c Line:96 🌰", "background:#ffdd4d");
      // 默认情况
      return result.text;
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

async function urlToBase64(url: string): Promise<string> {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  const base64 = Buffer.from(res.data).toString("base64");
  const mimeType = res.headers["content-type"] || "image/png";
  return `data:${mimeType};base64,${base64}`;
}
