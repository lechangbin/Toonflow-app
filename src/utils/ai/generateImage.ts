import axios from "axios";
import u from "@/utils";
import FormData from "form-data";
import axiosRetry from "axios-retry";
import sharp from "sharp";

interface ImageConfig {
  systemPrompt?: string;
  prompt: string;
  imageBase64: string[];
  size: "1K" | "2K" | "4K";
  aspectRatio: string;
  resType?: "url" | "b64";
}

interface ImageModelConfig {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  manufacturer?: "openAi" | "gemini" | "volcengine" | "runninghub" | "apimart";
}
// 上传 base64 图片到 runninghub
const uploadBase64ToRunninghub = async (base64Image: string, apiKey: string, baseURL: string): Promise<string> => {
  try {
    apiKey = apiKey.replace("Bearer ", "");
    // 移除 base64 前缀
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
    let buffer = Buffer.from(base64Data, "base64");

    // 压缩图片到 5MB 以下
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    if (buffer.length > MAX_SIZE) {
      let quality = 90;

      while (buffer.length > MAX_SIZE && quality > 10) {
        const compressed = await sharp(buffer).jpeg({ quality, mozjpeg: true }).toBuffer();
        buffer = Buffer.from(compressed);
        quality -= 10;
      }

      // 如果仍然超过限制，进一步调整尺寸
      if (buffer.length > MAX_SIZE) {
        const metadata = await sharp(buffer).metadata();
        const scale = Math.sqrt(MAX_SIZE / buffer.length);

        const resized = await sharp(buffer)
          .resize({
            width: Math.floor((metadata.width || 1920) * scale),
            height: Math.floor((metadata.height || 1080) * scale),
            fit: "inside",
          })
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer();

        buffer = Buffer.from(resized);
      }
    }

    // 创建 FormData
    const formData = new FormData();
    formData.append("file", buffer, {
      filename: "image.jpg",
      contentType: "image/jpeg",
    });

    // 上传图片
    const uploadRes = await axios.post(`https://www.runninghub.cn/openapi/v2/media/upload/binary`, formData, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (uploadRes.data.code !== 0 || !uploadRes.data.data?.download_url) {
      throw new Error(`图片上传失败: ${JSON.stringify(uploadRes.data)}`);
    }

    return uploadRes.data.data.download_url;
  } catch (error) {
    console.error("上传图片时发生错误:", error);
    throw error;
  }
};
const urlToBase64 = async (url: string): Promise<string> => {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  const base64 = Buffer.from(res.data).toString("base64");
  const mimeType = res.headers["content-type"] || "image/png";
  return `data:${mimeType};base64,${base64}`;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pollTask = async (
  queryFn: () => Promise<{ completed: boolean; imageUrl?: string; error?: string }>,
  maxAttempts = 500,
  interval = 2000,
): Promise<string> => {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(interval);
    const { completed, imageUrl, error } = await queryFn();
    if (error) throw new Error(error);
    if (completed && imageUrl) return imageUrl;
  }
  throw new Error(`任务轮询超时，已尝试 ${maxAttempts} 次`);
};

const generators = {
  volcengine: async (config: ImageConfig, apiKey: string, baseURL: string, model: string) => {
    if (config.size == "1K") config.size = "2K";
    apiKey = apiKey.replace("Bearer ", "");
    const body: Record<string, any> = {
      model,
      prompt: config.prompt,
      size: config.size,
      response_format: "url",
      sequential_image_generation: "disabled",
      stream: false,
      watermark: false,
    };
    // 图生图：存在图片时添加 image 字段
    if (config.imageBase64) {
      body.image = config.imageBase64;
    }
    const res = await axios.post(`https://ark.cn-beijing.volces.com/api/v3/images/generations`, body, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return res.data.data[0].url;
  },

  gemini: async (config: ImageConfig, apiKey: string, baseURL: string, model: string) => {
    apiKey = apiKey.replace("Bearer ", "");
    const messages = [
      ...(config.systemPrompt ? [{ role: "system", content: config.systemPrompt }] : []),
      { role: "user", content: config.prompt },
      ...config.imageBase64.map((img) => ({ role: "user", content: { image: img } })),
    ];
    const res = await axios.post(
      `${baseURL}/chat/completions`,
      { model, stream: false, messages, extra_body: { google: { image_config: { aspect_ratio: config.aspectRatio, image_size: config.size } } } },
      { headers: { Authorization: "Bearer " + apiKey } },
    );

    return res.data.choices[0].message.content;
  },

  runninghub: async (config: ImageConfig, apiKey: string, baseURL: string) => {
    apiKey = apiKey.replace("Bearer ", "");
    const imageUrls = await Promise.all(config.imageBase64.map((base64Image) => uploadBase64ToRunninghub(base64Image, apiKey, baseURL)));

    const endpoint = config.imageBase64.length === 0 ? "/openapi/v2/rhart-image-n-pro/text-to-image" : "/openapi/v2/rhart-image-n-pro/edit";
    const taskRes = await axios.post(
      `https://www.runninghub.cn${endpoint}`,
      { prompt: config.prompt, resolution: config.size, aspectRatio: config.aspectRatio, ...(imageUrls.length > 0 && { imageUrls }) },
      { headers: { Authorization: "Bearer " + apiKey } },
    );
    const taskId = taskRes.data.taskId;
    if (!taskId) throw new Error(`任务创建失败，${JSON.stringify(taskRes.data)}`);

    return pollTask(async () => {
      const res = await axios.post(`https://www.runninghub.cn/task/openapi/outputs`, { taskId, apiKey: apiKey });
      const { code, msg, data } = res.data;
      if (code === 0 && msg === "success") return { completed: true, imageUrl: data?.[0]?.fileUrl };
      if (code === 804 || code === 813) return { completed: false };
      if (code === 805) return { completed: false, error: `任务失败: ${data?.[0]?.failedReason?.exception_message || "未知原因"}` };
      return { completed: false, error: `未知状态: code=${code}, msg=${msg}` };
    });
  },

  apimart: async (config: ImageConfig, apiKey: string, baseURL: string, model: string) => {
    apiKey = apiKey.replace("Bearer ", "");
    const taskRes = await axios.post(
      `https://api.apimart.ai/v1/images/generations`,
      { model: "gemini-3-pro-image-preview", prompt: config.prompt, size: config.aspectRatio, n: 1, resolution: config.size },
      { headers: { Authorization: apiKey } },
    );

    if (taskRes.data.code !== 200 || !taskRes.data.data?.[0]?.task_id) throw new Error("任务创建失败: " + JSON.stringify(taskRes.data));

    const taskId = taskRes.data.data[0].task_id;
    return pollTask(async () => {
      const res = await axios.get(`https://api.apimart.ai/v1/tasks/${taskId}`, { headers: { Authorization: apiKey }, params: { language: "en" } });
      if (res.data.code !== 200) return { completed: false, error: `查询失败: ${JSON.stringify(res.data)}` };
      const { status, result } = res.data.data;
      if (status === "completed") return { completed: true, imageUrl: result?.images?.[0]?.url?.[0] };
      if (status === "failed" || status === "cancelled") return { completed: false, error: `任务${status}` };
      return { completed: false };
    });
  },
};
export default async (config: ImageConfig, replaceConfig?: ImageModelConfig) => {
  let { model, apiKey, baseURL, manufacturer } = await u.getConfig("image");
  if (replaceConfig) {
    model = replaceConfig.model || model;
    apiKey = replaceConfig.apiKey || apiKey;
    baseURL = replaceConfig.baseURL || baseURL;
    manufacturer = replaceConfig.manufacturer || manufacturer;
  }
  const generator = generators[manufacturer as keyof typeof generators];
  if (!generator) throw new Error(`不支持的厂商: ${manufacturer}`);

  let imageUrl = await generator(config, apiKey ?? "", baseURL ?? "", model ?? "");
  if (!config.resType) config.resType = "b64";
  if (config.resType === "b64" && imageUrl.startsWith("http")) imageUrl = await urlToBase64(imageUrl);
  return imageUrl;
};
