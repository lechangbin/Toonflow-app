// ==================== 类型定义 ====================
// 文本模型
interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

// 图像模型
interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

// 视频模型
interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: (
    | "singleImage"
    | "startEndRequired"
    | "endFrameOptional"
    | "startFrameOptional"
    | "text"
    | ("videoReference" | "imageReference" | "audioReference" | "textReference")[]
  )[];
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
  author: string;
  description?: string;
  name: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel)[];
}

// ==================== 全局工具函数声明 ====================
declare const zipImage: (completeBase64: string, size: number) => Promise<string>;
declare const zipImageResolution: (completeBase64: string, width: number, height: number) => Promise<string>;
declare const mergeImages: (completeBase64: string[], maxSize?: string) => Promise<string>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (
  fn: () => Promise<{ completed: boolean; data?: string; error?: string }>,
  interval?: number,
  timeout?: number,
) => Promise<{ completed: boolean; data?: string; error?: string }>;
declare const axios: any;
declare const createOpenAI: any;
declare const createDeepSeek: any;
declare const createZhipu: any;
declare const createQwen: any;
declare const createAnthropic: any;
declare const createOpenAICompatible: any;
declare const createXai: any;
declare const createMinimax: any;
declare const createGoogleGenerativeAI: any;
declare const logger: (logstring: string) => void;
declare const jsonwebtoken: any;

// ==================== 供应商数据 ====================
const vendor: VendorConfig = {
  id: "yunwu",
  author: "Toonflow",
  description: "OpenAI标准格式接口，您可以修改请求地址并手动添加缺失的模型。",
  name: "云雾中转",
  icon: "",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "以v1结束，示例：https://yunwu.ai/v1" },
  ],
  inputValues: {
    apiKey: "",
    baseUrl: "https://yunwu.ai/v1",
  },
  models: [
    {
      name: "Doubao-Seedream-5.0-lite",
      type: "image",
      modelName: "doubao-seedream-5-0-260128",
      mode: ["text", "singleImage", "multiReference"],
    },
    {
      name: "Gemini-3-Pro-Image-Preview",
      type: "image",
      modelName: "gemini-3.1-flash-image-preview",
      mode: ["text", "singleImage", "multiReference"],
      associationSkills: "高质量图像生成，支持文本生成图像、图像编辑",
    },
    {
      name: "Claude-sonnet-4.6",
      type: "text",
      modelName: "claude-sonnet-4-6",
      think: false,
    },
    {
      name: "Claude-haiku-4.5-20251001",
      type: "text",
      modelName: "claude-haiku-4-5-20251001",
      think: false,
    },
    {
      name: "Grok-Video-3",
      type: "video",
      modelName: "grok-video-3",
      mode: ["text", "singleImage"],
      audio: false,
      durationResolutionMap: [
        { duration: [6, 10], resolution: ["720P", "1080P"] }
      ],
      associationSkills: "文本生成视频,支持图片垫图"
    }
  ],
};
exports.vendor = vendor;

// ==================== 适配器函数 ====================

// 文本请求函数
const textRequest = (textModel: TextModel) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  if (!vendor.inputValues.baseUrl) throw new Error("缺少请求地址(baseUrl)");

  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const baseURL = vendor.inputValues.baseUrl;

  return createOpenAI({
    baseURL: baseURL,
    apiKey: apiKey,
  }).chat(textModel.modelName);
};
exports.textRequest = textRequest;

// 图片请求函数（修正版：使用 /v1/chat/completions 兼容接口）
interface ImageConfig {
  prompt: string;
  imageBase64: string[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

const imageRequest = async (imageConfig: ImageConfig, imageModel: ImageModel) => {
  const { apiKey, baseUrl } = vendor.inputValues;
  if (!apiKey) throw new Error("缺少API Key");
  if (!baseUrl) throw new Error("缺少请求地址(baseUrl)");

  const cleanApiKey = apiKey.replace(/^Bearer\s+/i, "");
  const baseURL = baseUrl.replace(/\/$/, "");
  const endpoint = baseURL + "/chat/completions";

  // 构建用户消息内容（支持多图垫图）
  const content: any[] = [
    {
      type: "text",
      text: imageConfig.prompt,
    },
  ];

  // 添加参考图片（垫图）
  if (imageConfig.imageBase64 && imageConfig.imageBase64.length > 0) {
    for (const imgBase64 of imageConfig.imageBase64) {
      let dataUrl = imgBase64;
      if (!imgBase64.startsWith("data:image")) {
        dataUrl = `data:image/png;base64,${imgBase64}`;
      }
      content.push({
        type: "image_url",
        image_url: { url: dataUrl },
      });
    }
  }

  // 注意：云雾中转站可能支持通过额外参数传递图像尺寸/比例，
  // 若不确定，可将 size 和 aspectRatio 拼接到 prompt 中（推荐）。
  // 这里采用追加提示词的方式，确保模型理解期望的分辨率和比例。
  let finalPrompt = imageConfig.prompt;
  const sizeMap: Record<string, string> = { "1K": "1024x1024", "2K": "2048x2048", "4K": "4096x4096" };
  const resolution = sizeMap[imageConfig.size] || "1024x1024";
  finalPrompt += `\n请生成一张比例为 ${imageConfig.aspectRatio}、分辨率不低于 ${resolution} 的图片。`;
  content[0].text = finalPrompt;

  const requestBody = {
    model: imageModel.modelName,
    messages: [
      {
        role: "user",
        content: content,
      },
    ],
    max_tokens: 4096,       // 防止输出截断
    response_format: { type: "json_object" }, // 部分中转站需要 JSON 输出
  };

  logger(`[图像生成] 请求URL: ${endpoint}`);
  logger(`[图像生成] 模型: ${imageModel.modelName}`);
  logger(`[图像生成] 参考图片数量: ${imageConfig.imageBase64?.length || 0}`);

  try {
    const response = await axios.post(endpoint, requestBody, {
      headers: {
        "Authorization": `Bearer ${cleanApiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 120000,
    });

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(response.data)}`);
    }

    const assistantMessage = response.data?.choices?.[0]?.message?.content;
    if (!assistantMessage) {
      throw new Error("响应中没有 assistant 消息内容");
    }

    // 提取图像数据（支持直接返回 base64 data URL 或普通 URL）
    let imageBase64: string | null = null;
    // 情况1：消息内容本身就是 data:image 开头
    if (assistantMessage.startsWith("data:image")) {
      imageBase64 = assistantMessage;
    }
    // 情况2：包含 Markdown 图片链接 ![alt](url)
    else {
      const markdownMatch = assistantMessage.match(/!\[.*?\]\((.*?)\)/);
      if (markdownMatch && markdownMatch[1]) {
        const url = markdownMatch[1];
        if (url.startsWith("data:image")) {
          imageBase64 = url;
        } else {
          imageBase64 = await urlToBase64(url);
        }
      }
      // 情况3：直接是纯文本 URL
      else if (assistantMessage.match(/^https?:\/\/[^\s]+\.(png|jpg|jpeg|gif|webp)/i)) {
        imageBase64 = await urlToBase64(assistantMessage);
      }
    }

    if (!imageBase64) {
      // 最后尝试：也许整个 content 就是 base64 字符串（无前缀）
      if (/^[A-Za-z0-9+/=]+$/.test(assistantMessage) && assistantMessage.length > 100) {
        imageBase64 = `data:image/png;base64,${assistantMessage}`;
      } else {
        throw new Error(`无法从响应中提取图像数据: ${assistantMessage.substring(0, 200)}`);
      }
    }

    logger(`[图像生成] 成功，图片大小: ${(imageBase64.length / 1024).toFixed(2)} KB`);
    return imageBase64;
  } catch (error: any) {
    logger(`[图像生成] 失败: ${error.message}`);
    if (error.response) {
      logger(`[图像生成] API 错误详情: ${JSON.stringify(error.response.data)}`);
      throw new Error(`图像生成失败: ${error.response.data?.error?.message || error.message}`);
    }
    throw error;
  }
};
exports.imageRequest = imageRequest;

// 视频请求函数（保持原有实现，若云雾中转站有专用视频接口可按需修改）
interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  imageBase64?: string[];
  audio?: boolean;
  mode:
  | "singleImage"
  | "multiImage"
  | "gridImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | ("video" | "image" | "audio" | "text")[];
}

const videoRequest = async (videoConfig: VideoConfig, videoModel: VideoModel) => {
  const { apiKey, baseUrl: rawBaseUrl } = vendor.inputValues;
  if (!apiKey) throw new Error("缺少API Key");
  const baseUrl = rawBaseUrl?.trim();
  if (!baseUrl) throw new Error("缺少请求地址(baseUrl)");

  const createEndpoint = baseUrl.replace(/\/$/, "") + "/video/create";
  const queryEndpoint = baseUrl.replace(/\/$/, "") + "/video/query";

  let images: string[] | undefined;
  if (videoConfig.imageBase64 && videoConfig.imageBase64.length > 0) {
    logger(`[视频生成] 原始图片数组: ${JSON.stringify(videoConfig.imageBase64)}`);
    images = videoConfig.imageBase64
      .filter(img => img && typeof img === 'string' && img.length > 0)
      .map(img => {
        if (img.startsWith("data:image")) return img;
        return `data:image/png;base64,${img}`;
      });
    if (images.length === 0) {
      logger(`[视频生成] 警告: 所有图片都无效，将忽略图片参数`);
      images = undefined;
    } else {
      logger(`[视频生成] 有效图片数量: ${images.length}`);
    }
  }

  let aspectRatioParam: string;
  switch (videoConfig.aspectRatio) {
    case "16:9": aspectRatioParam = "3:2"; break;
    case "9:16": aspectRatioParam = "2:3"; break;
    default: aspectRatioParam = "1:1";
  }

  let sizeParam: string = "720P";
  if (videoConfig.resolution && videoConfig.resolution.includes("1080")) sizeParam = "1080P";

  const createBody: any = {
    model: videoModel.modelName,
    prompt: videoConfig.prompt,
    aspect_ratio: aspectRatioParam,
    size: sizeParam,
  };
  if (images && images.length > 0) createBody.images = images;

  try {
    logger(`[视频生成] 创建请求体: ${JSON.stringify({ ...createBody, images: images ? `${images.length}张图片` : undefined })}`);
    const createResp = await axios.post(createEndpoint, createBody, {
      headers: {
        "Authorization": `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    if (createResp.status !== 200 || !createResp.data?.id) {
      throw new Error(`创建任务失败: ${JSON.stringify(createResp.data)}`);
    }

    const taskId = createResp.data.id;
    logger(`[视频生成] 任务已创建，ID: ${taskId}`);

    const pollResult = await pollTask(
      async () => {
        try {
          const queryResp = await axios.get(queryEndpoint, {
            params: { id: taskId },
            headers: {
              "Authorization": `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
              "Content-Type": "application/json",
            },
            timeout: 15000,
          });

          if (queryResp.status !== 200) {
            return { completed: false, error: `查询失败: HTTP ${queryResp.status}` };
          }

          const data = queryResp.data;
          const status = data.status;
          logger(`[视频生成] 任务状态: ${status}`);

          if (status === "succeeded" || status === "completed" || status === "success") {
            if (data.video_url) {
              return { completed: true, data: data.video_url };
            } else {
              return { completed: false, error: "任务成功但未返回视频URL" };
            }
          } else if (status === "failed" || status === "error") {
            return { completed: false, error: `视频生成失败: ${data.error || "未知错误"}` };
          } else {
            return { completed: false };
          }
        } catch (err: any) {
          logger(`[视频生成] 轮询出错: ${err.message}`);
          return { completed: false, error: err.message };
        }
      },
      3000,
      300000
    );

    if (!pollResult.completed) {
      throw new Error(pollResult.error || "视频生成超时或失败");
    }

    const videoUrl = pollResult.data;
    logger(`[视频生成] 成功，视频URL: ${videoUrl}`);
    return videoUrl;
  } catch (error: any) {
    logger(`[视频生成] 失败: ${error.message}`);
    if (error.response) {
      logger(`[视频生成] API 错误详情: ${JSON.stringify(error.response.data)}`);
      throw new Error(`视频生成失败: ${error.response.data?.error?.message || error.message}`);
    }
    throw error;
  }
};
exports.videoRequest = videoRequest;

// TTS 请求函数（占位）
interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
}
const ttsRequest = async (ttsConfig: TTSConfig, ttsModel: TTSModel) => {
  return null;
};
exports.ttsRequest = ttsRequest;