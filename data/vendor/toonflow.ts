//如需遥测AI请使用在toonflow安装目录运行npx @ai-sdk/devtools （要求在其他设置中打开遥测功能，且toonflow有权限在安装目录创建.devtools文件夹）
// ==================== 类型定义 ====================
// 文本模型
interface TextModel {
  name: string; // 显示名称
  modelName: string;
  type: "text";
  think: boolean; // 前端显示用
}

// 图像模型
interface ImageModel {
  name: string; // 显示名称
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string; // 关联技能，多个技能用逗号分隔
}
// 视频模型
interface VideoModel {
  name: string; // 显示名称
  modelName: string; //全局唯一
  type: "video";
  mode: (
    | "singleImage" // 单图
    | "startEndRequired" // 首尾帧（两张都得有）
    | "endFrameOptional" // 首尾帧（尾帧可选）
    | "startFrameOptional" // 首尾帧（首帧可选）
    | "text" // 文本生视频
    | ("videoReference" | "imageReference" | "audioReference" | "textReference")[]
  )[]; // 混合参考
  associationSkills?: string; // 关联技能，多个技能用逗号分隔
  audio: "optional" | false | true; // 音频配置
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface TTSModel {
  name: string; // 显示名称
  modelName: string;
  type: "tts";
  voices: {
    title: string; //显示名称
    voice: string; //说话人
  }[];
}
// 供应商配置
interface VendorConfig {
  id: string; //供应商唯一标识，必须全局唯一
  author: string;
  description?: string; //md5格式
  name: string;
  icon?: string; //仅支持base64格式
  inputs: {
    key: string;
    label: string;
    type: "text" | "password" | "url";
    required: boolean;
    placeholder?: string;
  }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel)[];
}
// ==================== 全局工具函数 ====================
//Axios实例
//压缩图片大小(1MB = 1 * 1024 * 1024)
declare const zipImage: (completeBase64: string, size: number) => Promise<string>;
//压缩图片分辨率
declare const zipImageResolution: (completeBase64: string, width: number, height: number) => Promise<string>;
//多图拼接乘单图 maxSize  最大输出大小，默认为 10mb
declare const mergeImages: (completeBase64: string[], maxSize?: string) => Promise<string>;
//Url转Base64
declare const urlToBase64: (url: string) => Promise<string>;
//轮询函数
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
  id: "toonflow",
  author: "Toonflow",
  description:
    "## Toonflow官方中转平台\n\nToonflow官方中转平台，提供**文本、图像、视频、音频**等多模态生成能力的中转服务，支持接入多个大模型供应商，方便用户统一管理和调用不同供应商的生成能力。\n\n🔗 [前往中转平台](https://api.toonflow.net/)\n\n如果这个项目对你有帮助，可以考虑支持一下我们的开发工作 ☕",
  name: "Toonflow官方中转平台",
  icon: "",
  inputs: [{ key: "apiKey", label: "API密钥", type: "password", required: true }],
  inputValues: {
    apiKey: "",
    baseUrl: "https://api.toonflow.net/v1",
  },
  models: [
    {
      name: "claude-sonnet-4-6",
      type: "text",
      modelName: "claude-sonnet-4-6",
      think: false,
    },
    {
      name: "claude-opus-4-6",
      type: "text",
      modelName: "claude-opus-4-6",
      think: false,
    },
    {
      name: "claude-sonnet-4-5-20250929",
      type: "text",
      modelName: "claude-sonnet-4-5-20250929",
      think: false,
    },
    {
      name: "claude-opus-4-5-20251101",
      type: "text",
      modelName: "claude-opus-4-5-20251101",
      think: false,
    },
    {
      name: "claude-haiku-4-5-20251001",
      type: "text",
      modelName: "claude-haiku-4-5-20251001",
      think: false,
    },
    {
      name: "gpt-5.4",
      type: "text",
      modelName: "gpt-5.4",
      think: false,
    },
    {
      name: "gpt-5.2",
      type: "text",
      modelName: "gpt-5.2",
      think: false,
    },
    {
      name: "MiniMax-M2.7",
      type: "text",
      modelName: "MiniMax-M2.7",
      think: true,
    },
    {
      name: "MiniMax-M2.5",
      type: "text",
      modelName: "MiniMax-M2.5",
      think: true,
    },
    {
      name: "Wan2.6 I2V 1080P (支持真人)",
      type: "video",
      modelName: "Wan2.6-I2V-1080P",
      mode: ["text", "startEndRequired"],
      durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["1080p"] }],
      audio: true,
    },
    {
      name: "Wan2.6 I2V 720P (支持真人)",
      type: "video",
      modelName: "Wan2.6-I2V-720P",
      mode: ["text", "startEndRequired"],
      durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["720p"] }],
      audio: true,
    },
    {
      name: "Seedance 1.5 Pro",
      type: "video",
      modelName: "doubao-seedance-1-5-pro-251215",
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] }],
      mode: ["text", "endFrameOptional"],
      audio: true,
    },
    {
      name: "vidu2 turbo",
      type: "video",
      modelName: "ViduQ2-turbo",
      durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolution: ["540p", "720p", "1080p"] }],
      mode: ["singleImage", "startEndRequired"],
      audio: false,
    },
    {
      name: "ViduQ3 pro",
      type: "video",
      modelName: "ViduQ3-pro",
      durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], resolution: ["540p", "720p", "1080p"] }],
      mode: ["singleImage", "startEndRequired"],
      audio: false,
    },
    {
      name: "ViduQ2 pro",
      type: "video",
      modelName: "ViduQ2-pro",
      durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolution: ["540p", "720p", "1080p"] }],
      mode: ["singleImage", "startEndRequired"],
      audio: false,
    },

    {
      name: "Doubao Seedream 5.0 Lite",
      type: "image",
      modelName: "Doubao-Seedream-5.0-Lite",
      mode: ["text", "singleImage", "multiReference"],
    },
    {
      name: "Doubao Seedream 4.5",
      type: "image",
      modelName: "doubao-seedream-4-5-251128",
      mode: ["text", "singleImage", "multiReference"],
    },
  ],
};
exports.vendor = vendor;

// ==================== 适配器函数 ====================

// 文本请求函数
const textRequest: (textModel: TextModel) => { url: string; model: string } = (textModel) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace("Bearer ", "");

  return createOpenAI({
    baseURL: vendor.inputValues.baseUrl,
    apiKey: apiKey,
  }).chat(textModel.modelName);
};
exports.textRequest = textRequest;

//图片请求函数
interface ImageConfig {
  prompt: string; //图片提示词
  imageBase64: string[]; //输入的图片提示词
  size: "1K" | "2K" | "4K"; // 图片尺寸
  aspectRatio: `${number}:${number}`; // 长宽比
}
//豆包格式适配
function doubaoAdaptor(imageConfig: ImageConfig, imageModel: ImageModel) {
  const size = imageConfig.size === "1K" ? "2K" : imageConfig.size;
  const sizeMap: Record<string, Record<string, string>> = {
    "16:9": {
      "2k": "2848x1600",
      "2K": "2848x1600",
      "4K": "4096x2304",
      "4k": "4096x2304",
    },
    "9:16": {
      "4k": "2304x4096",
      "2k": "1600x2848",
      "2K": "1600x2848",
      "4K": "2304x4096",
    },
  };
  const body = {
    model: imageModel.modelName,
    prompt: imageConfig.prompt,
    size: sizeMap[imageConfig.aspectRatio][size],
    response_format: "url",
    sequential_image_generation: "disabled",
    stream: false,
    watermark: false,
    ...(imageConfig.imageBase64 && { image: imageConfig.imageBase64 }),
  };
  return {
    body,
    processFn: (data) => {
      return data.data[0].url;
    },
  };
}

// 提取图片内容
function extractFirstImageFromMd(content) {
  const regex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s)]+|\/\/[^\s)]+|[^\s)]+)\)/;
  const match = content.match(regex);
  if (!match) return null;
  const raw = match[2].trim();
  const url = raw.startsWith("data:") ? raw : raw.split(/\s+/)[0];
  return {
    alt: match[1],
    url,
    type: url.startsWith("data:image") ? "base64" : "url",
  };
}
// gemini 图片请求适配
function geminiImageAdaptor(imageConfig: ImageConfig, imageModel: ImageModel) {
  const images = [];
  if (imageConfig.imageBase64 && imageConfig.imageBase64.length) {
    images.push({
      role: "user",
      content: imageConfig.imageBase64.map((i) => ({
        type: "image_url",
        image_url: {
          url: i,
        },
      })),
    });
  }
  const imageConfigGoogle = {
    aspect_ratio: imageConfig.aspectRatio,
  };
  // if(imageModel.ModelName == 'gemini-3-pro-image-preview-vt'){
  imageConfigGoogle.image_size = imageConfig.size;
  // }
  const body = {
    model: imageModel.modelName,
    messages: [{ role: "user", content: imageConfig.prompt + `请直接输出图片` }, ...images],
    extra_body: {
      google: {
        image_config: {
          ...imageConfigGoogle,
        },
      },
    },
  };
  return {
    body,
    url: `${vendor.inputValues.baseUrl}/chat/completions`,
    processFn: (data: any) => {
      return extractFirstImageFromMd(data.choices[0].message.content).url;
    },
  };
}
function commonAdaptor(imageConfig: ImageConfig, imageModel: ImageModel) {
  const defaultImageFn = [
    ["doubao", doubaoAdaptor],
    ["nano", geminiImageAdaptor],
    ["gemini", geminiImageAdaptor],
    ["seedream", doubaoAdaptor],
  ];
  const modelName = imageModel.modelName;
  const lowerName = modelName.toLowerCase();
  const match = defaultImageFn.find(([key]) => lowerName.includes(key));
  return match ? match[1](imageConfig, imageModel) : {};
}
const imageRequest = async (imageConfig: ImageConfig, imageModel: ImageModel) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace("Bearer ", "");
  const adaptor = commonAdaptor(imageConfig, imageModel);

  const requestUrl = adaptor?.url ? `${vendor.inputValues.baseUrl}/chat/completions` : vendor.inputValues.baseUrl + "/images/generations";
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(adaptor.body),
  });
  if (!response.ok) {
    const errorText = await response.text(); // 获取错误信息
    console.error("请求失败，状态码:", response.status, ", 错误信息:", errorText);
    throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
  }
  const data = await response.json();
  return adaptor.processFn(data);
};
exports.imageRequest = imageRequest;

interface VideoConfig {
  duration: number; //视频时长，单位秒
  resolution: string; //视频分辨率，如"720p"、"1080p"
  aspectRatio: "16:9" | "9:16"; //视频长宽比
  prompt: string; //视频提示词
  fileBase64?: string[]; // 文件base64 包含图片base64、视频base64、音频base64
  audio?: boolean;
  mode:
    | "singleImage" // 单图
    | "multiImage" // 多图模式
    | "gridImage" // 网格单图（传入一张图片，但该图片是网格图）
    | "startEndRequired" // 首尾帧（两张都得有）
    | "endFrameOptional" // 首尾帧（尾帧可选）
    | "startFrameOptional" // 首尾帧（首帧可选）
    | "text" // 文本生视频
    | ("videoReference" | "imageReference" | "audioReference" | "textReference")[]; // 混合参考
}
// 豆包视频
const buildDoubaoMetadata = (videoConfig: VideoConfig) => {
  const metaData = {
    ...(typeof videoConfig.audio == "boolean" && { generate_audio: videoConfig.audio ?? false }),
    ratio: videoConfig.aspectRatio,
    image_roles: [],
    references: [],
  };
  if (videoConfig.imageBase64 && videoConfig.imageBase64.length) {
    videoConfig.imageBase64.forEach((i, index) => {
      if (Array.isArray(videoConfig.mode)) {
        metaData.references.push(i);
      } else {
        if (videoConfig.mode == "startEndRequired" || videoConfig.mode == "endFrameOptional" || videoConfig.mode == "startFrameOptional") {
          (metaData.image_roles as string[]).push(index == 0 ? "first_frame" : "last_frame");
        }
        if (videoConfig.mode == "singleImage") {
          (metaData.image_roles as string[]).push("reference_image");
        }
      }
    });
  }

  return metaData;
};

// 万象
const buildWanMetadata = (videoConfig: VideoConfig) => {
  const images = videoConfig.imageBase64 ?? [];
  const metaData: Record<string, string | boolean> = {};
  if (
    (videoConfig.mode === "startEndRequired" || videoConfig.mode == "endFrameOptional" || videoConfig.mode == "startFrameOptional") &&
    images.length == 2
  ) {
    if (images[0]) metaData.first_frame_url = images[0];
    if (images[1]) metaData.last_frame_url = images[1];
  } else if (images.length) {
    metaData.img_url = images[0]!;
  }
  if (typeof videoConfig.audio == "boolean") {
    metaData.audio = videoConfig.audio;
  }
  return metaData;
};
// 千问视频
const buildViduMetadata = (videoConfig: VideoConfig) => ({
  aspect_ratio: videoConfig.aspectRatio,
  audio: videoConfig.audio ?? false,
  off_peak: false,
});
// 可灵
const buildKlingAdaptor = (videoConfig: VideoConfig) => {
  const metaData: any = {
    aspect_ratio: videoConfig.aspectRatio,
  };

  if (videoConfig.imageBase64 && videoConfig.imageBase64.length) {
    if (Array.isArray(videoConfig.mode)) {
      metaData.reference = videoConfig.imageBase64;
    }
    if (videoConfig.mode == "endFrameOptional") {
      metaData.image_tail = videoConfig.imageBase64[0];
    }
    if (videoConfig.mode == "startEndRequired") {
      metaData.image_list = [
        {
          image_url: videoConfig.imageBase64[0],
          type: "first_frame",
        },
        {
          image_url: videoConfig.imageBase64[1],
          type: "last_frame",
        },
      ];
    }
    if (videoConfig.mode == "singleImage") {
      metaData.image = videoConfig.imageBase64[0];
    }
  }

  return metaData;
};
type MetadataBuilder = (config: VideoConfig) => Record<string, any>;
const METADATA_BUILDERS: Array<[string, MetadataBuilder]> = [
  ["doubao", buildDoubaoMetadata],
  ["wan", buildWanMetadata],
  ["vidu", buildViduMetadata],
  ["seedance", buildDoubaoMetadata],
  ["kling", buildKlingAdaptor],
];
const buildModelMetadata = (modelName: string, videoConfig: VideoConfig) => {
  const lowerName = modelName.toLowerCase();
  const match = METADATA_BUILDERS.find(([key]) => lowerName.includes(key));
  return match ? match[1](videoConfig) : {};
};
const videoRequest = async (videoConfig: VideoConfig, videoModel: VideoModel) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace("Bearer ", "");
  try {
    videoConfig.mode = JSON.parse(videoConfig.mode);
  } catch (e) {
    videoConfig.mode = videoConfig.mode as any;
  }
  // 构建每个模型对应的附加参数
  const metadata = buildModelMetadata(videoModel.modelName, videoConfig);

  //公共请求参数
  const publicBody = {
    model: videoModel.modelName,
    ...(videoConfig.imageBase64 && videoConfig.imageBase64.length && !Array.isArray(videoConfig.mode) ? { images: videoConfig.imageBase64 } : {}),
    prompt: videoConfig.prompt,
    duration: videoConfig.duration,
    metadata: metadata,
  };

  if (videoModel.modelName.toLocaleLowerCase().includes("wan")) {
    const sizeMap: Record<string, Record<string, string>> = {
      "480p": {
        "16:9": "832*480",
        "9:16": "480*832",
      },
      "720p": {
        "16:9": "1280*720",
        "9:16": "720*1280",
      },
      "1080p": {
        "16:9": "1920*1080",
        "9:16": "1080*1920",
      },
    };
    const size = sizeMap[videoConfig.resolution]?.[videoConfig.aspectRatio];
    publicBody.size = size;
  }
  const requestUrl = vendor.inputValues.baseUrl + "/video/generations";
  const queryUrl = vendor.inputValues.baseUrl + "/video/generations/{id}";
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(publicBody),
  });
  if (!response.ok) {
    const errorText = await response.text(); // 获取错误信息
    console.error("请求失败，状态码:", response.status, ", 错误信息:", errorText);
    throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
  }
  const data = await response.json();
  const taskId = data.id;
  const res = await pollTask(async () => {
    const queryResponse = await fetch(queryUrl.replace("{id}", taskId), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    if (!queryResponse.ok) {
      const errorText = await queryResponse.text(); // 获取错误信息
      console.error("请求失败，状态码:", queryResponse.status, ", 错误信息:", errorText);
      throw new Error(`请求失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}`);
    }
    const queryData = await queryResponse.json();
    const status = queryData?.status ?? queryData?.data?.status;
    const fail_reason = queryData?.data?.fail_reason ?? queryData?.data;
    switch (status) {
      case "completed":
      case "SUCCESS":
      case "success":
        return { completed: true, data: queryData.data.result_url };
      case "FAILURE":
        return { completed: false, error: fail_reason || "视频生成失败" };
      default:
        return { completed: false };
    }
  });
  if (res.error) throw new Error(res.error);
  return res.data;
};
exports.videoRequest = videoRequest;

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
