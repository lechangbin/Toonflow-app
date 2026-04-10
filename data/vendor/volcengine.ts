/**
 * Toonflow AI供应商模板 - 火山引擎(豆包)
 * @version 2.0
 */
// ============================================================
// 类型定义
// ============================================================
type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];
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
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
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
interface ImageConfig {
  prompt: string;
  imageBase64: string[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}
interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: string[];
  audio?: boolean;
  mode: VideoMode[];
}
interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
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
  textRequest: (m: TextModel) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};
// ============================================================
// 供应商配置
// ============================================================
const vendor: VendorConfig = {
  id: "volcengine-doubao",
  version: "2.0",
  author: "Toonflow",
  name: "火山引擎(豆包)",
  description: "## 火山引擎豆包大模型，支持文本、图片生成、视频生成等能力。\n\n需要在[火山引擎控制台](https://console.volcengine.com/ark)获取API密钥。",
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
    // Seedance 2.0: 多模态参考(图0~9+视频0~3+音频0~3) + 首尾帧 + 首帧 + 文生视频
    {
      name: "Seedance-2.0(音画同生)",
      modelName: "doubao-seedance-2-0-260128",
      type: "video",
      mode: [
        "text",
        "startFrameOptional",
        ["imageReference:9", "videoReference:3", "audioReference:3"],
      ],
      audio: "optional",
      durationResolutionMap: [
        { duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p"] },
      ],
    },
    {
      name: "Seedance-2.0-Fast(音画同生)",
      modelName: "doubao-seedance-2-0-fast-260128",
      type: "video",
      mode: [
        "text",
        "startFrameOptional",
        ["imageReference:9", "videoReference:3", "audioReference:3"],
      ],
      audio: "optional",
      durationResolutionMap: [
        { duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p"] },
      ],
    },
    // Seedance 1.5 pro: 首尾帧 + 首帧 + 文生视频
    {
      name: "Seedance-1.5-Pro(音画同生)",
      modelName: "doubao-seedance-1-5-pro-251215",
      type: "video",
      mode: ["text", "startFrameOptional"],
      audio: "optional",
      durationResolutionMap: [
        { duration: [4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] },
      ],
    },
    // Seedance 1.0 pro: 首尾帧 + 首帧 + 文生视频
    {
      name: "Seedance-1.0-Pro",
      modelName: "doubao-seedance-1-0-pro-250528",
      type: "video",
      mode: ["text", "startFrameOptional"],
      audio: false,
      durationResolutionMap: [
        { duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] },
      ],
    },
    // Seedance 1.0 pro fast: 首帧 + 文生视频（不支持首尾帧）
    {
      name: "Seedance-1.0-Pro-Fast",
      modelName: "doubao-seedance-1-0-pro-fast-251015",
      type: "video",
      mode: ["text", "singleImage"],
      audio: false,
      durationResolutionMap: [
        { duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] },
      ],
    },
    // Seedance 1.0 lite t2v: 仅文生视频
    {
      name: "Seedance-1.0-Lite-T2V",
      modelName: "doubao-seedance-1-0-lite-t2v-250428",
      type: "video",
      mode: ["text"],
      audio: false,
      durationResolutionMap: [
        { duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] },
      ],
    },
    // Seedance 1.0 lite i2v: 参考图(1~4) + 首尾帧 + 首帧
    {
      name: "Seedance-1.0-Lite-I2V",
      modelName: "doubao-seedance-1-0-lite-i2v-250428",
      type: "video",
      mode: ["startFrameOptional", ["imageReference:4"]],
      audio: false,
      durationResolutionMap: [
        { duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] },
      ],
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

/** 文本请求 - 直接使用 createOpenAI */
const textRequest = (model: TextModel) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  return createOpenAI({ baseURL: getBaseUrl(), apiKey }).chat(model.modelName);
};

/** 图片生成请求 */
const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  // 构建 content
  const content: any[] = [];

  // 文本提示词
  if (config.prompt) {
    content.push({ type: "text", text: config.prompt });
  }

  // 图片输入
  if (config.imageBase64 && config.imageBase64.length > 0) {
    for (const base64 of config.imageBase64) {
      content.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${base64}` },
      });
    }
  }

  // 解析宽高比
  const [w, h] = config.aspectRatio.split(":").map(Number);

  // 解析尺寸到像素
  const sizeMap: Record<string, { width: number; height: number }> = {
    "1K": { width: 1024, height: Math.round(1024 * (h / w)) },
    "2K": { width: 2048, height: Math.round(2048 * (h / w)) },
    "4K": { width: 4096, height: Math.round(4096 * (h / w)) },
  };
  const size = sizeMap[config.size] || sizeMap["1K"];

  const body = {
    model: model.modelName,
    content,
    size: `${size.width}x${size.height}`,
    response_format: "url",
  };

  logger(`[图片生成] 请求模型: ${model.modelName}`);

  const response = await axios.post(`${baseUrl}/images/generations`, body, { headers });
  const data = response.data;

  if (data?.data?.[0]?.url) {
    return await urlToBase64(data.data[0].url);
  }

  throw new Error("图片生成失败：未返回有效结果");
};

/** 视频生成请求 */
const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  // 构建 content
  const content: any[] = [];

  // 文本提示词
  if (config.prompt) {
    content.push({ type: "text", text: config.prompt });
  }

  // 判断当前使用的 mode
  const activeMode = config.mode && config.mode.length > 0 ? config.mode[0] : "text";

  if (typeof activeMode === "string") {
    switch (activeMode) {
      case "singleImage":
        // 首帧模式：单张图片，role 为 first_frame
        if (config.imageBase64 && config.imageBase64.length > 0) {
          content.push({
            type: "image_url",
            image_url: { url: `data:image/png;base64,${config.imageBase64[0]}` },
            role: "first_frame",
          });
        }
        break;
      case "startFrameOptional":
        // 首帧 + 可选尾帧模式
        if (config.imageBase64 && config.imageBase64.length > 0) {
          content.push({
            type: "image_url",
            image_url: { url: `data:image/png;base64,${config.imageBase64[0]}` },
            role: "first_frame",
          });
          if (config.imageBase64.length > 1) {
            content.push({
              type: "image_url",
              image_url: { url: `data:image/png;base64,${config.imageBase64[1]}` },
              role: "last_frame",
            });
          }
        }
        break;
      case "text":
        // 纯文生视频，无需额外处理
        break;
    }
  } else if (Array.isArray(activeMode)) {
    // 多模态参考模式
    let imageIndex = 0;
    for (const ref of activeMode) {
      if (typeof ref === "string") {
        if (ref.startsWith("imageReference:")) {
          // 参考图片
          const maxCount = parseInt(ref.split(":")[1], 10);
          if (config.imageBase64) {
            const images = config.imageBase64.slice(imageIndex, imageIndex + maxCount);
            for (const base64 of images) {
              content.push({
                type: "image_url",
                image_url: { url: `data:image/png;base64,${base64}` },
                role: "reference_image",
              });
            }
            imageIndex += images.length;
          }
        }
        // videoReference 和 audioReference 需要 URL，当前框架暂不支持直接传入
      }
    }
  }

  // 映射宽高比
  const ratioMap: Record<string, string> = {
    "16:9": "16:9",
    "9:16": "9:16",
    "4:3": "4:3",
    "3:4": "3:4",
    "1:1": "1:1",
    "21:9": "21:9",
  };
  const ratio = ratioMap[config.aspectRatio] || "16:9";

  const body: any = {
    model: model.modelName,
    content,
    ratio,
    duration: config.duration,
    resolution: config.resolution || "720p",
    watermark: false,
  };

  // 音频控制
  if (model.audio === "optional") {
    body.generate_audio = config.audio !== false;
  } else if (model.audio === true) {
    body.generate_audio = true;
  } else {
    body.generate_audio = false;
  }

  logger(`[视频生成] 提交任务, 模型: ${model.modelName}, 时长: ${config.duration}s, 分辨率: ${config.resolution}`);

  // 提交创建任务
  const createResponse = await axios.post(`${baseUrl}/contents/generations/tasks`, body, { headers });
  const taskId = createResponse.data?.id;

  if (!taskId) {
    throw new Error("视频生成任务创建失败：未返回任务ID");
  }

  logger(`[视频生成] 任务已创建, ID: ${taskId}`);

  // 轮询查询任务状态
  const result = await pollTask(async (): Promise<PollResult> => {
    const queryResponse = await axios.get(`${baseUrl}/contents/generations/tasks/${taskId}`, { headers });
    const task = queryResponse.data;

    logger(`[视频生成] 任务状态: ${task.status}`);

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
        // queued / running
        return { completed: false };
    }
  }, 10000, 600000); // 每10秒查询一次，最长等待10分钟

  if (result.error) {
    throw new Error(result.error);
  }

  return result.data || "";
};

/** TTS请求（火山引擎暂无TTS模型配置，预留接口） */
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