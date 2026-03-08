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
export default async (input: VideoConfig, config: AIConfig): Promise<string> => {
  if (!config.model) throw new Error("缺少Model名称");
  if (!config.apiKey) throw new Error("缺少API Key");

  const defaultBaseURL = "http://127.0.0.1:3000/videogenerator/generate|http://127.0.0.1:3000/videogenerator/generate/{id}";
  const { requestUrl, queryUrl } = getApiUrl(config.baseURL! ?? defaultBaseURL);
  // 根据 size 配置映射到具体尺寸
  const sizeMap: Record<string, Record<string, string>> = {
    "480P": {
      "16:9": "832*480",
      "9:16": "480*332",
    },
    "720P": {
      "16:9": "1280*720",
      "9:16": "720*1280",
    },
    "1080P": {
      "16:9": "1920*1080",
      "9:16": "1080*1920",
    },
  };
  // 构建完整的提示词
  let mergedImage = input.imageBase64;
  if (mergedImage && mergedImage.length) {
    const smallImage = await u.imageTools.mergeImages(mergedImage, "5mb");
    mergedImage = [smallImage];
  }

  const size = sizeMap[input.resolution]?.[input.aspectRatio] ?? "1280*720";
  const imageCount: { type: string; image_url: string }[] = [];
  if (input.imageBase64 && input.imageBase64.length) {
    input.imageBase64.forEach((i, index) => {
      imageCount.push({
        type: "image_url",
        image_url: { url: i },
        role: index === 0 ? "first_frame" : "last_frame",
      });
    });
  }
  const taskBody: Record<string, any> = {
    model: config.model,
    content: [
      {
        type: "text",
        text: input.prompt,
      },
      ...imageCount,
    ],
    // parameters: {
    //   aspect_ratio: input.aspectRatio,
    //   size: input.resolution,
    //   duration: input.duration,
    // },
    // ...(typeof input.audio === "boolean" ? { generate_audio: input.audio } : {}),
  };
  console.log("%c Line:62 🥑 taskBody", "background:#ea7e5c", taskBody);

  const apiKey = config.apiKey.replace("Bearer ", "");
  try {
    const { data } = await axios.post(requestUrl, taskBody, { headers: { Authorization: `Bearer ${apiKey}` } });
    console.log("%c Line:70 🥪 data", "background:#ed9ec7", data);
    console.log("%c Line:84 🍐 data.code != uccess", "background:#e41a6a", data.code != "success");
    console.log("%c Line:83 🍇 data.code", "background:#b03734", data.code);

    if (data.code != "success") throw new Error(`任务提交失败: ${data || "未知错误"}`);
    const taskId = data.data;

    return await pollTask(async () => {
      const { data: queryData } = await axios.get(template({ id: taskId }, queryUrl), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      console.log("%c Line:77 🍧 data", "background:#f5ce50", queryData);

      const { status, result_url, fail_reason } = queryData.data || {};

      if (status === "FAILURE") {
        return { completed: false, error: fail_reason ? fail_reason : "视频生成失败" };
      }

      if (status === "SUCCESS") {
        return { completed: true, url: result_url };
      }

      return { completed: false };
    });
  } catch (error: any) {
    console.log("%c Line:105 🍖 error", "background:#ed9ec7", error);
    const msg = u.error(error).message || "图片生成失败";
    console.log("%c Line:107 🌽 u.error(error)", "background:#ea7e5c", u.error(error));
    throw new Error(msg);
  }
};

async function urlToBase64(url: string): Promise<string> {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  const base64 = Buffer.from(res.data).toString("base64");
  const mimeType = res.headers["content-type"] || "image/png";
  return `data:${mimeType};base64,${base64}`;
}
