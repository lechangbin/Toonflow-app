import "../type";
import { generateImage, generateText, ModelMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { pollTask } from "@/utils/ai/utils";
import u from "@/utils";
import axios from "axios";
function getApiUrl(apiUrl: string) {
  if (apiUrl.includes("|")) {
    const parts = apiUrl.split("|");
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
      throw new Error("url 格式错误，请使用 url1|url2 格式");
    }
    return { requestUrl: parts[0].trim(), queryUrl: parts[1].trim() };
  }
  throw new Error("请填写正确的url");
}
function template(replaceObj: Record<string, any>, url: string) {
  return url.replace(/\{(\w+)\}/g, (match, varName) => {
    return replaceObj.hasOwnProperty(varName) ? replaceObj[varName] : match;
  });
}
export default async (input: ImageConfig, config: AIConfig): Promise<string> => {
  if (!config.model) throw new Error("缺少Model名称");
  if (!config.apiKey) throw new Error("缺少API Key");

  const defaultBaseURL = "http://127.0.0.1:3000/imagegenerator/task|http://127.0.0.1:3000/imagegenerator/task/{id}";
  const { requestUrl, queryUrl } = getApiUrl(config.baseURL! ?? defaultBaseURL);
  // 根据 size 配置映射到具体尺寸
  const sizeMap: Record<string, Record<string, string>> = {
    "1K": {
      "16:9": "1664x928",
      "9:16": "928x1664",
    },
    "2K": {
      "16:9": "2048x1152",
      "9:16": "1152x2048",
    },
    "4K": {
      "16:9": "2048x1152",
      "9:16": "1328*1328",
    },
  };
  const modelSizeMap = {
    "Qwen-Image": {
      "16:9": "1664*928",
      "9:16": "928*1664",
    },
    "Z-Image-Turbo": {
      "16:9": "1024*768",
      "9:16": "768*1024",
    },
  };
  // 构建完整的提示词
  const fullPrompt = input.systemPrompt ? `${input.systemPrompt}\n\n${input.prompt}` : input.prompt;

  let mergedImage = input.imageBase64;
  if (mergedImage && mergedImage.length) {
    const smallImage = await u.imageTools.mergeImages(mergedImage, "5mb");
    mergedImage = [smallImage];
  }

  const size = modelSizeMap?.[config.model]?.[input.size]?.[input.aspectRatio] ?? modelSizeMap?.[config.model]?.[input.size] ?? "1024*1024";

  const taskBody: Record<string, any> = {
    model: config.model,
    input: {
      prompt: fullPrompt,
      ...(input.imageBase64 && input.imageBase64.length ? { images: input.imageBase64 } : {}),
    },
    parameters: {
      size:"1600*2848",
    },
    // negative_prompt: "",
  };

  const apiKey = config.apiKey.replace("Bearer ", "");
  try {
    const { data } = await axios.post(requestUrl, taskBody, { headers: { Authorization: `Bearer ${apiKey}` } });
    console.log("%c Line:70 🥪 data", "background:#ed9ec7", data);

    if (data.code != "success") throw new Error(`任务提交失败: ${data || "未知错误"}`);
    const taskId = data.data;

    return await pollTask(async () => {
      const { data: queryData } = await axios.get(template({ id: taskId }, queryUrl), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      console.log("%c Line:77 🍧 data", "background:#f5ce50", data);
      console.log("%c Line:76 🥑 queryData", "background:#2eafb0", queryData);

      const { status, result_url, fail_reason } = queryData.data || {};

      if (status === "FAILURE") {
        return { completed: false, error: fail_reason ?? "图片生成失败" };
      }

      if (status === "SUCCESS") {
        return { completed: true, url: result_url };
      }

      return { completed: false };
    });
  } catch (error: any) {
    const msg = u.error(error).message || "图片生成失败";
    throw new Error(msg);
  }
};

async function urlToBase64(url: string): Promise<string> {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  const base64 = Buffer.from(res.data).toString("base64");
  const mimeType = res.headers["content-type"] || "image/png";
  return `data:${mimeType};base64,${base64}`;
}
