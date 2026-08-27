/**
 * Toonflow AI供应商模板 - 火山引擎(豆包)
 * @version 2.0
 */

// ============================================================
// 类型定义
// ============================================================

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  associationSkills?: string;
  capabilities: {
    id: "text-to-video" | "image-to-video";
    promptProfileId: string;
    inputs: { role: "source-image"; mediaType: "image"; required: true }[];
    audio: { generation: "native"; policy: "optional" };
    outputPresets: {
      id: string;
      resolution: string;
      durations: { kind: "values"; values: number[] };
      aspectRatios: ("16:9" | "9:16")[];
    }[];
  }[];
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}

interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoCommandBase {
  modelId: string;
  prompt: string;
  output: { presetId: string; duration: number; resolution: string; aspectRatio: "16:9" | "9:16" };
  audio: { generation: "native"; enabled: boolean };
}

type VideoGenerationCommand =
  | (VideoCommandBase & { capabilityId: "text-to-video" })
  | (VideoCommandBase & { capabilityId: "image-to-video"; sourceImage: { mediaType: "image"; base64: string } });

interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
  referenceList?: Extract<ReferenceList, { type: "audio" }>[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

// ============================================================
// 全局声明
// ============================================================

declare const axios: any;
declare const logger: (msg: string) => void;
declare const jsonwebtoken: any;
declare const zipImage: (base64: string, size: number) => Promise<string>;
declare const zipImageResolution: (base64: string, w: number, h: number) => Promise<string>;
declare const mergeImages: (base64Arr: string[], maxSize?: string) => Promise<string>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const createOpenAI: any;
declare const createDeepSeek: any;
declare const createZhipu: any;
declare const createQwen: any;
declare const createAnthropic: any;
declare const createOpenAICompatible: any;
declare const createXai: any;
declare const createMinimax: any;
declare const createGoogleGenerativeAI: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoGenerationCommand, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "volcengine",
  version: "2.4",
  author: "leeqi",
  name: "火山引擎(豆包)",
  description: "火山引擎豆包大模型，支持文本、图片生成、视频生成等能力。\n\n需要在[火山引擎控制台](https://console.volcengine.com/ark)获取API密钥。",
  icon: "",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true, placeholder: "火山引擎API Key" },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "以v3结束，示例：https://ark.cn-beijing.volces.com/api/v3" },
  ],
  inputValues: {
    apiKey: "",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  },
  models: [
    // ===================== 文本模型 - 推荐 =====================
    { name: "Doubao-Seed-2.0-Pro", modelName: "doubao-seed-2-0-pro-260215", type: "text", think: true },
    { name: "Doubao-Seed-2.0-Lite", modelName: "doubao-seed-2-0-lite-260215", type: "text", think: true },
    { name: "Doubao-Seed-2.0-Mini", modelName: "doubao-seed-2-0-mini-260215", type: "text", think: true },
    { name: "Doubao-Seed-2.0-Code-Preview", modelName: "doubao-seed-2-0-code-preview-260215", type: "text", think: true },
    { name: "Doubao-Seed-Character", modelName: "doubao-seed-character-251128", type: "text", think: false },
    // ===================== 文本模型 - 往期 =====================
    { name: "Doubao-Seed-1.8", modelName: "doubao-seed-1-8-251228", type: "text", think: true },
    { name: "Doubao-Seed-Code-Preview", modelName: "doubao-seed-code-preview-251028", type: "text", think: true },
    { name: "Doubao-Seed-1.6-Lite", modelName: "doubao-seed-1-6-lite-251015", type: "text", think: true },
    { name: "Doubao-Seed-1.6-Flash(0828)", modelName: "doubao-seed-1-6-flash-250828", type: "text", think: true },
    { name: "Doubao-Seed-1.6-Vision", modelName: "doubao-seed-1-6-vision-250815", type: "text", think: true },
    { name: "Doubao-Seed-1.6(1015)", modelName: "doubao-seed-1-6-251015", type: "text", think: true },
    { name: "Doubao-Seed-1.6(0615)", modelName: "doubao-seed-1-6-250615", type: "text", think: true },
    { name: "Doubao-Seed-1.6-Flash(0615)", modelName: "doubao-seed-1-6-flash-250615", type: "text", think: true },
    { name: "Doubao-Seed-Translation", modelName: "doubao-seed-translation-250915", type: "text", think: false },
    { name: "Doubao-1.5-Pro-32K", modelName: "doubao-1-5-pro-32k-250115", type: "text", think: false },
    { name: "Doubao-1.5-Pro-32K-Character(0715)", modelName: "doubao-1-5-pro-32k-character-250715", type: "text", think: false },
    { name: "Doubao-1.5-Pro-32K-Character(0228)", modelName: "doubao-1-5-pro-32k-character-250228", type: "text", think: false },
    { name: "Doubao-1.5-Lite-32K", modelName: "doubao-1-5-lite-32k-250115", type: "text", think: false },
    { name: "Doubao-1.5-Vision-Pro-32K", modelName: "doubao-1-5-vision-pro-32k-250115", type: "text", think: false },
    // ===================== 文本模型 - 第三方(火山引擎托管) =====================
    { name: "GLM-4-7", modelName: "glm-4-7-251222", type: "text", think: true },
    { name: "DeepSeek-V3-2", modelName: "deepseek-v3-2-251201", type: "text", think: true },
    { name: "DeepSeek-V3-1-Terminus", modelName: "deepseek-v3-1-terminus", type: "text", think: true },
    { name: "DeepSeek-V3(0324)", modelName: "deepseek-v3-250324", type: "text", think: false },
    { name: "DeepSeek-R1(0528)", modelName: "deepseek-r1-250528", type: "text", think: true },
    { name: "Qwen3-32B", modelName: "qwen3-32b-20250429", type: "text", think: false },
    { name: "Qwen3-14B", modelName: "qwen3-14b-20250429", type: "text", think: false },
    { name: "Qwen3-8B", modelName: "qwen3-8b-20250429", type: "text", think: false },
    { name: "Qwen3-0.6B", modelName: "qwen3-0-6b-20250429", type: "text", think: false },
    { name: "Qwen2.5-72B", modelName: "qwen2-5-72b-20240919", type: "text", think: false },
    { name: "GLM-4.5-Air", modelName: "glm-4-5-air", type: "text", think: false },
    // ===================== 图片生成模型 =====================
    {
      name: "Seedream-5.0",
      modelName: "doubao-seedream-5-0-260128",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
    },
    {
      name: "Seedream-5.0-Lite",
      modelName: "doubao-seedream-5-0-lite-260128",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
    },
    {
      name: "Seedream-4.5",
      modelName: "doubao-seedream-4-5-251128",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
    },
    {
      name: "Seedream-4.0",
      modelName: "doubao-seedream-4-0-250828",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
    },
    {
      name: "Seedream-3.0-T2I",
      modelName: "doubao-seedream-3-0-t2i-250415",
      type: "image",
      mode: ["text"],
    },
    // ===================== 视频生成模型 =====================
    {
      name: "Seedance-2.0(音画同生)",
      modelName: "doubao-seedance-2-0-260128",
      type: "video",
      associationSkills: "Seedance 2.0 官方文生视频与单图生视频；多参考图能力暂不开放。",
      capabilities: ["text-to-video", "image-to-video"].map((id) => ({
        id,
        promptProfileId: id === "text-to-video" ? "seedance/text-v1" : "seedance/image-v1",
        inputs: id === "text-to-video" ? [] : [{ role: "source-image" as const, mediaType: "image" as const, required: true as const }],
        audio: { generation: "native" as const, policy: "optional" as const },
        outputPresets: ["480p", "720p"].map((resolution) => ({
          id: resolution,
          resolution,
          durations: { kind: "values" as const, values: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
          aspectRatios: ["16:9" as const, "9:16" as const],
        })),
      })) as VideoModel["capabilities"],
    },
    {
      name: "Seedance-2.0-Fast(音画同生)",
      modelName: "doubao-seedance-2-0-fast-260128",
      type: "video",
      associationSkills: "Seedance 2.0 Fast 官方文生视频与单图生视频；多参考图能力暂不开放。",
      capabilities: ["text-to-video", "image-to-video"].map((id) => ({
        id,
        promptProfileId: id === "text-to-video" ? "seedance/text-v1" : "seedance/image-v1",
        inputs: id === "text-to-video" ? [] : [{ role: "source-image" as const, mediaType: "image" as const, required: true as const }],
        audio: { generation: "native" as const, policy: "optional" as const },
        outputPresets: ["480p", "720p"].map((resolution) => ({
          id: resolution,
          resolution,
          durations: { kind: "values" as const, values: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
          aspectRatios: ["16:9" as const, "9:16" as const],
        })),
      })) as VideoModel["capabilities"],
    },
  ],
};

// ============================================================
// 辅助工具
// ============================================================

const getHeaders = () => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "")}`,
  };
};

const getBaseUrl = () => vendor.inputValues.baseUrl.replace(/\/+$/, "");

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");

  const effortMap: Record<number, string> = {
    0: "minimal",
    1: "low",
    2: "medium",
    3: "high",
  };

  return createOpenAICompatible({
    name: "volcengine",
    baseURL: getBaseUrl(),
    apiKey,
    fetch: async (url: string, options?: RequestInit) => {
      const rawBody = JSON.parse((options?.body as string) ?? "{}");
      const modifiedBody = {
        ...rawBody,
        thinking: {
          type: "enabled",
        },
        reasoning_effort: effortMap[thinkLevel],
      };
      return await fetch(url, {
        ...options,
        body: JSON.stringify(modifiedBody),
      });
    },
  }).chatModel(model.modelName);
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  const body: any = {
    model: model.modelName,
    prompt: config.prompt || "",
    response_format: "url",
    watermark: false,
  };

  const isOldModel = model.modelName.includes("seedream-3-0");
  const is5Lite = model.modelName.includes("seedream-5-0-lite");

  // sequential_image_generation 仅 seedream 5.0-lite/4.5/4.0 支持
  if (!isOldModel) {
    body.sequential_image_generation = "disabled";
  }

  // 参考图片：单图为 string，多图为 array（seedream-3.0-t2i 不支持 image 参数）
  if (!isOldModel && config.referenceList && config.referenceList.length > 0) {
    const images = config.referenceList.map((ref) => ref.base64);
    body.image = images.length === 1 ? images[0] : images;
  }

  // 尺寸处理：优先使用推荐像素值，未匹配则直接传分辨率字符串让模型自行决定
  const [w, h] = config.aspectRatio.split(":").map(Number);
  const sizeTable: Record<string, Record<string, string>> = {
    "1K": {
      "1:1": "1024x1024",
      "4:3": "1152x864",
      "3:4": "864x1152",
      "16:9": "1280x720",
      "9:16": "720x1280",
      "3:2": "1248x832",
      "2:3": "832x1248",
      "21:9": "1512x648",
    },
    "2K": {
      "1:1": "2048x2048",
      "4:3": "2304x1728",
      "3:4": "1728x2304",
      "16:9": "2848x1600",
      "9:16": "1600x2848",
      "3:2": "2496x1664",
      "2:3": "1664x2496",
      "21:9": "3136x1344",
    },
    "4K": {
      "1:1": "4096x4096",
      "4:3": "4704x3520",
      "3:4": "3520x4704",
      "16:9": "5504x3040",
      "9:16": "3040x5504",
      "3:2": "4992x3328",
      "2:3": "3328x4992",
      "21:9": "6240x2656",
    },
  };

  const sizeKey = config.size || "2K";
  const ratioKey = config.aspectRatio;
  const table = sizeTable[sizeKey];

  if (table && table[ratioKey]) {
    // 推荐像素值匹配到了，但需要检查是否满足模型最低像素要求
    const [pw, ph] = table[ratioKey].split("x").map(Number);
    const totalPixels = pw * ph;
    if (isOldModel) {
      // seedream-3.0-t2i: 像素范围 [512x512, 2048x2048]
      body.size = table[ratioKey];
    } else if (totalPixels < 3686400) {
      // 1K 像素值不满足新模型最低要求，直接传 "2K" 让模型自行决定
      body.size = "2K";
    } else if (is5Lite && totalPixels > 10404496) {
      // seedream-5.0-lite 最高 10404496，4K 超限，回退传 "2K"
      body.size = "2K";
    } else {
      body.size = table[ratioKey];
    }
  } else if (isOldModel) {
    // seedream-3.0-t2i: 像素范围 [512x512, 2048x2048]，直接按比例计算
    const base = sizeKey === "1K" ? 1024 : 2048;
    const calcW = Math.min(2048, Math.round(base * Math.sqrt(w / h)));
    const calcH = Math.min(2048, Math.round(base * Math.sqrt(h / w)));
    body.size = `${Math.max(512, calcW)}x${Math.max(512, calcH)}`;
  } else {
    // 新模型未匹配推荐值时，直接传分辨率字符串（方式1），由模型根据 prompt 自行决定尺寸
    // seedream 5.0-lite 支持 "2K"/"3K"，seedream 4.5 支持 "2K"/"4K"，seedream 4.0 支持 "1K"/"2K"/"4K"
    if (is5Lite) {
      body.size = sizeKey === "4K" ? "3K" : sizeKey === "1K" ? "2K" : sizeKey;
    } else {
      body.size = sizeKey === "1K" ? "2K" : sizeKey;
    }
  }

  logger(`[图片生成] 请求模型: ${model.modelName}, 尺寸: ${body.size}`);
  const res = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`图片生成请求失败: ${errorText}`);
  }
  const response = await res.json();
  logger(response);

  if (response?.error) {
    throw new Error(`图片生成失败：${response.error.message || response.error.code}`);
  }

  // 从 data 数组中提取第一张成功的图片
  if (response?.data && response.data.length > 0) {
    for (const item of response.data) {
      if (item.url) {
        return await urlToBase64(item.url);
      }
      if (item.b64_json) {
        return item.b64_json;
      }
      if (item.error) {
        throw new Error(`图片生成失败：${item.error.message || item.error.code}`);
      }
    }
  }

  throw new Error("图片生成失败：未返回有效结果");
};

const videoRequest = async (config: VideoGenerationCommand, model: VideoModel): Promise<string> => {
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  const content: any[] = [];

  content.push({ type: "text", text: config.prompt });
  if (config.capabilityId === "image-to-video") {
    content.push({
      type: "image_url",
      image_url: { url: config.sourceImage.base64 },
      role: "first_frame",
    });
  }

  const body: any = {
    model: model.modelName,
    content,
    ratio: config.output.aspectRatio,
    duration: config.output.duration,
    resolution: config.output.resolution,
    watermark: false,
    generate_audio: config.audio.enabled,
  };

  logger(`[视频生成] 提交任务, 模型: ${model.modelName}, 时长: ${config.output.duration}s, 分辨率: ${config.output.resolution}`);
  const res = await fetch(`${baseUrl}/contents/generations/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`视频生成任务创建失败: ${errorText}`);
  }
  const createResponse = await res.json();
  logger(createResponse);
  const taskId = createResponse?.id;

  if (!taskId) {
    throw new Error("视频生成任务创建失败：未返回任务ID");
  }

  logger(`[视频生成] 任务已创建, ID: ${taskId}`);

  const result = await pollTask(
    async (): Promise<PollResult> => {
      const queryRes = await fetch(`${baseUrl}/contents/generations/tasks/${taskId}`, {
        method: "GET",
        headers,
      });
      if (!queryRes.ok) {
        const errorText = await queryRes.text();
        throw new Error(`查询视频生成任务状态失败: ${errorText}`);
      }
      const task = await queryRes.json();

      logger(`[视频生成] 任务状态: ${JSON.stringify(task)}`);

      switch (task.status) {
        case "succeeded":
          if (task.content?.video_url) {
            return { completed: true, data: task.content.video_url };
          }
          return { completed: true, error: "任务成功但未返回视频URL" };
        case "failed":
          return { completed: true, error: task.error?.message || "视频生成失败" };
        case "expired":
          return { completed: true, error: "视频生成任务超时" };
        case "cancelled":
          return { completed: true, error: "视频生成任务已取消" };
        default:
          return { completed: false };
      }
    },
    10000,
    600000 * 3,
  );

  if (result.error) {
    throw new Error(result.error);
  }

  return result.data!;
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";
};

const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: "2.0", notice: "" };
};

const updateVendor = async (): Promise<string> => {
  return "";
};

// ============================================================
// 导出
// ============================================================

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;

export {};
