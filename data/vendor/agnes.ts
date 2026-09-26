/**
 * ToonFlow Agnes AI 供应商适配器
 * @version 2.6
 * @see https://www.agnes-ai.com/zh-Hans/docs/overview
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
  maxReferenceImages?: number;
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  associationSkills?: string;
  capabilities: {
    id: "text-to-video" | "image-to-video" | "first-last-frame" | "keyframe-to-video";
    promptProfileId: string;
    inputs: { role: "source-image" | "first-frame" | "intermediate-keyframe" | "last-frame"; mediaType: "image"; required: boolean }[];
    transitions?: { kind: "adjacent-keyframes" };
    audio: { generation: "native"; policy: "always" };
    outputPresets: {
      id: string;
      resolution: string;
      durations: { kind: "integer-range"; min: number; max: number; step: number };
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
  /** Issue #39：供应商获得执行槽以及 URL 媒体下载边界的事实回调。 */
  onStage?: (stage: "generating" | "downloading" | "downloaded") => void | Promise<void>;
}

interface ResolvedImage {
  mediaType: "image";
  base64: string;
}

interface VideoCommandBase {
  modelId: string;
  prompt: string;
  output: {
    presetId: string;
    duration: number;
    resolution: string;
    aspectRatio: "16:9" | "9:16";
  };
  audio: { generation: "native"; enabled: true };
  resumeTask?: {
    videoId?: string;
    taskId?: string;
    retry?: number;
  };
  onTaskCheckpoint?: (checkpoint: VideoTaskCheckpoint) => Promise<void> | void;
}

type VideoGenerationCommand =
  | (VideoCommandBase & { capabilityId: "text-to-video" })
  | (VideoCommandBase & { capabilityId: "image-to-video"; sourceImage: ResolvedImage })
  | (VideoCommandBase & { capabilityId: "first-last-frame";
      firstFrame: ResolvedImage; lastFrame: ResolvedImage })
  | (VideoCommandBase & {
      capabilityId: "keyframe-to-video";
      firstFrame: ResolvedImage;
      intermediateKeyframe?: ResolvedImage;
      lastFrame: ResolvedImage;
    });

interface VideoTaskCheckpoint {
  vendorId: "agnes";
  modelName: string;
  videoId?: string;
  taskId?: string;
  stage: "poll" | "download" | "completed" | "failed";
  retry: number;
}

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
declare const fetch: any;
declare const logger: (msg: string) => void;
declare const jsonwebtoken: any;
declare const zipImage: (base64: string, size: number) => Promise<string>;
declare const zipImageResolution: (base64: string, w: number, h: number) => Promise<string>;
declare const mergeImages: (base64Arr: string[], maxSize?: string) => Promise<string>;
declare const urlToBase64: (url: string, config?: any) => Promise<string>;
declare const sleep: (milliseconds: number) => Promise<void>;
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
  id: "agnes",
  version: "2.6",
  author: "Agnes AI",
  name: "Agnes AI",
  description:
    "Agnes AI 官方全模态 API 适配。支持 Agnes 3.0/2.5/2.0 Flash 文本、Image 2.5/2.1/2.0 Flash 图像，以及 Video 2.5 Flash/V2.0 视频生成。",
  inputs: [
    { key: "apiKey", label: "API Key", type: "password", required: true, placeholder: "Agnes AI API Key" },
    {
      key: "baseUrl",
      label: "API 地址",
      type: "url",
      required: true,
      placeholder: "https://apihub.agnes-ai.com",
    },
  ],
  inputValues: {
    apiKey: "",
    baseUrl: "https://apihub.agnes-ai.com",
  },
  models: [
    {
      name: "Agnes 3.0 Flash",
      modelName: "agnes-3.0-flash",
      type: "text",
      think: true,
    },
    {
      name: "Agnes 2.5 Flash",
      modelName: "agnes-2.5-flash",
      type: "text",
      think: true,
    },
    {
      name: "Agnes 2.0 Flash",
      modelName: "agnes-2.0-flash",
      type: "text",
      think: true,
    },
    {
      name: "Agnes 2.5 Pro（付费）",
      modelName: "agnes-2.5-pro",
      type: "text",
      think: true,
    },
    {
      name: "Agnes 2.5 Pro Alpha（付费）",
      modelName: "agnes-2.5-pro-alpha",
      type: "text",
      think: true,
    },
    {
      name: "Agnes Image 2.5 Flash",
      modelName: "agnes-image-2.5-flash",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      maxReferenceImages: 6,
      associationSkills: "文生图、图像编辑和多图合成；六张 Base64 参考图已实测可用，七张被服务商拒绝。",
    },
    {
      name: "Agnes Image 2.1 Flash",
      modelName: "agnes-image-2.1-flash",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      maxReferenceImages: 6,
      associationSkills: "高信息密度图像、复杂构图、文生图、图像编辑和多图合成；支持 1K/2K/4K 与多种宽高比。",
    },
    {
      name: "Agnes Image 2.0 Flash",
      modelName: "agnes-image-2.0-flash",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      maxReferenceImages: 6,
      associationSkills: "快速文生图、图像编辑和多图合成。",
    },
    {
      name: "Agnes Video 2.5 Flash",
      modelName: "agnes-video-2.5-flash",
      type: "video",
      associationSkills: "异步文生视频、单图与首尾帧；仅 720P、4–12 秒，原生音频始终开启。图片 Base64 兼容由用户实测，本轮云端任务仍待复验。",
      capabilities: [
        {
          id: "text-to-video",
          promptProfileId: "agnes/text-v1",
          inputs: [],
          audio: { generation: "native", policy: "always" },
          outputPresets: [{ id: "720p", resolution: "720p",
            durations: { kind: "integer-range", min: 4, max: 12, step: 1 },
            aspectRatios: ["16:9", "9:16"] }],
        },
        {
          id: "image-to-video",
          promptProfileId: "agnes/image-v1",
          inputs: [{ role: "source-image", mediaType: "image", required: true }],
          audio: { generation: "native", policy: "always" },
          outputPresets: [{ id: "720p", resolution: "720p",
            durations: { kind: "integer-range", min: 4, max: 12, step: 1 },
            aspectRatios: ["16:9", "9:16"] }],
        },
        {
          id: "first-last-frame",
          promptProfileId: "agnes/keyframe-v1",
          inputs: [
            { role: "first-frame", mediaType: "image", required: true },
            { role: "last-frame", mediaType: "image", required: true },
          ],
          audio: { generation: "native", policy: "always" },
          outputPresets: [{ id: "720p", resolution: "720p",
            durations: { kind: "integer-range", min: 4, max: 12, step: 1 },
            aspectRatios: ["16:9", "9:16"] }],
        },
      ],
    },
    {
      name: "Agnes Video V2.0",
      modelName: "agnes-video-v2.0",
      type: "video",
      associationSkills: "异步文生视频、单图生视频与显式首帧/中间关键帧/尾帧动画；原生音频始终开启。",
      capabilities: [
        {
          id: "text-to-video",
          promptProfileId: "agnes/text-v1",
          inputs: [],
          audio: { generation: "native", policy: "always" },
          outputPresets: ["480p", "720p", "1080p"].map((resolution) => ({
            id: resolution,
            resolution,
            durations: { kind: "integer-range" as const, min: 1, max: 18, step: 1 },
            aspectRatios: ["16:9" as const, "9:16" as const],
          })),
        },
        {
          id: "image-to-video",
          promptProfileId: "agnes/image-v1",
          inputs: [{ role: "source-image", mediaType: "image", required: true }],
          audio: { generation: "native", policy: "always" },
          outputPresets: ["480p", "720p", "1080p"].map((resolution) => ({
            id: resolution,
            resolution,
            durations: { kind: "integer-range" as const, min: 1, max: 18, step: 1 },
            aspectRatios: ["16:9" as const, "9:16" as const],
          })),
        },
        {
          id: "keyframe-to-video",
          promptProfileId: "agnes/keyframe-v1",
          inputs: [
            { role: "first-frame", mediaType: "image", required: true },
            { role: "intermediate-keyframe", mediaType: "image", required: false },
            { role: "last-frame", mediaType: "image", required: true },
          ],
          transitions: { kind: "adjacent-keyframes" },
          audio: { generation: "native", policy: "always" },
          outputPresets: ["480p", "720p", "1080p"].map((resolution) => ({
            id: resolution,
            resolution,
            durations: { kind: "integer-range" as const, min: 1, max: 18, step: 1 },
            aspectRatios: ["16:9" as const, "9:16" as const],
          })),
        },
      ],
    },
  ],
};

// ============================================================
// 辅助工具
// ============================================================

const getBaseUrl = (): string => {
  const configured = (vendor.inputValues.baseUrl || "https://apihub.agnes-ai.com")
    .trim()
    .replace(/^http:\/\/apihub\.agnes-ai\.com(?::443)?/i, "https://apihub.agnes-ai.com")
    .replace(/\/+$/, "");
  return configured.replace(/\/v1$/i, "");
};

const getOpenAIBaseUrl = (): string => `${getBaseUrl()}/v1`;

const getHeaders = () => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 Agnes AI API Key");
  return {
    Authorization: `Bearer ${vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  };
};

const getErrorMessage = (error: any, fallback: string): string => {
  const data = error?.response?.data;
  const message =
    data?.error?.message ||
    data?.error ||
    data?.detail ||
    data?.message ||
    data?.msg ||
    (typeof data === "string" ? data : undefined) ||
    (data && typeof data === "object" ? JSON.stringify(data) : undefined) ||
    error?.message;
  const status = error?.response?.status;
  const statusText = status ? `（HTTP ${status}）` : "";
  return message
    ? `${fallback}${statusText}：${typeof message === "string" ? message : JSON.stringify(message)}`
    : `${fallback}${statusText}`;
};

type VideoStage = "submit" | "poll" | "download";

const formatUnknownError = (value: any, fallback = "unknown error"): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const safeDetails = ["stage", "code", "status", "name"]
      .flatMap((key) => {
        const field = value[key];
        return typeof field === "string" || typeof field === "number" ? [`${key}=${field}`] : [];
      })
      .join(" ");
    return safeDetails || fallback;
  }
  return value == null ? fallback : String(value);
};

const getProviderErrorDetails = (error: any) => {
  const data = error?.response?.data;
  const rawMessage =
    data?.error?.message ||
    data?.detail ||
    data?.message ||
    data?.msg ||
    (typeof data === "string" ? data : undefined) ||
    error?.message ||
    formatUnknownError(error);
  return {
    httpStatus: Number(error?.response?.status || 0) || undefined,
    providerCode: data?.error?.code || data?.code || error?.code,
    message: formatUnknownError(rawMessage),
  };
};

const formatVideoError = (
  stage: VideoStage,
  error: any,
  ids: { videoId?: string; taskId?: string },
  retry: number,
): string => {
  const details = getProviderErrorDetails(error);
  return [
    "[Agnes Video]",
    `stage=${stage}`,
    `httpStatus=${details.httpStatus ?? "none"}`,
    `providerCode=${details.providerCode ?? "none"}`,
    `video_id=${ids.videoId ?? "none"}`,
    `task_id=${ids.taskId ?? "none"}`,
    `retry=${retry}`,
    `message=${details.message}`,
  ].join(" ");
};

const isRetryableVideoTransportError = (error: any): boolean => {
  const details = getProviderErrorDetails(error);
  const httpStatus = details.httpStatus || 0;
  if (httpStatus === 408 || httpStatus === 429 || (httpStatus >= 500 && httpStatus <= 599)) return true;
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ECONNABORTED|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|socket hang up|timeout/i.test(
    `${details.providerCode || ""} ${details.message}`,
  );
};

const getVideoRetryBackoffMs = (retry: number): number => {
  const exponential = Math.min(60000, 1000 * 2 ** Math.max(0, retry - 1));
  const jitter = Math.floor(Math.random() * Math.max(250, exponential * 0.25));
  return exponential + jitter;
};

const isExplicitQueueFullError = (error: any): boolean => {
  const details = getProviderErrorDetails(error);
  return (
    /video_queue_full|queue[_ -]?full/i.test(String(details.providerCode || "")) ||
    /video queue is full|queue capacity|队列.*满/i.test(details.message)
  );
};

const getSubmitQueueBackoffMs = (retry: number): number => {
  const exponential = Math.min(60000, 10000 * 2 ** Math.max(0, retry - 1));
  const jitter = Math.floor(Math.random() * Math.max(1000, exponential * 0.2));
  return exponential + jitter;
};

let imageRequestQueue: Promise<void> = Promise.resolve();

const runImageRequestSerially = async <T>(task: () => Promise<T>): Promise<T> => {
  const previous = imageRequestQueue;
  let release = () => {};
  imageRequestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await task();
  } finally {
    release();
  }
};

const waitWithPollTask = async (waitMs: number): Promise<void> => {
  const startedAt = Date.now();
  const result = await pollTask(
    async (): Promise<PollResult> => ({ completed: Date.now() - startedAt >= waitMs }),
    Math.min(500, Math.max(100, waitMs)),
    waitMs + 5000,
  );

  if (result.error) throw new Error(`等待重试失败：${result.error}`);
};

// ============================================================
// 图片失败诊断（Issue #39）
// ============================================================

type ImageFailureKind = "timeout" | "transport" | "httpError" | "noImageData" | "downloadFailed";

interface ImageFailureDiagnostics {
  kind: ImageFailureKind;
  stage: "generation" | "download";
  attempt: number;
  elapsedMs?: number;
  transportCode?: string;
  httpStatus?: number;
  providerRequestId?: string;
}

const getImageResponseText = (error: any): string => {
  const data = error?.response?.data;
  const responseValue =
    data?.error?.message || data?.message || data?.detail || data?.msg ||
    (typeof data === "string" ? data : undefined) ||
    error?.message || "";
  return typeof responseValue === "string" ? responseValue : JSON.stringify(responseValue);
};

const getProviderRequestId = (error: any): string | undefined => {
  const headers = error?.response?.headers || {};
  for (const key of ["x-request-id", "request-id", "x-trace-id"]) {
    const value = headers[key];
    if (typeof value === "string") {
      const normalized = value.trim().slice(0, 128);
      if (/^[A-Za-z0-9._:-]+$/.test(normalized)) return normalized;
    }
  }
  return undefined;
};

const classifyImageRequestError = (error: any): "timeout" | "transport" | "httpError" => {
  const status = Number(error?.response?.status || 0);
  if (status > 0) return "httpError";
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (code === "ECONNABORTED" || code === "ETIMEDOUT" || /timeout of \d+ms exceeded/i.test(message)) return "timeout";
  return "transport";
};

/**
 * 构造带白名单诊断的图片失败错误：诊断通过 error.imageFailure 传回领域层。
 * 只包含阶段/尝试次数/耗时/传输码/HTTP 状态/清理后的请求 ID 与脱敏消息；
 * 绝不包含 API Key、Authorization、提示词、参考图或结果 Base64、签名 URL。
 */
const buildImageFailure = (
  kind: ImageFailureKind,
  stage: "generation" | "download",
  error: any,
  attempt: number,
  startedAt: number,
): Error => {
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const transportCode = error?.code ? String(error.code).slice(0, 64) : undefined;
  const httpStatus = Number(error?.response?.status || 0) || undefined;
  const providerRequestId = getProviderRequestId(error);
  const failure: any = new Error(`Agnes 图片生成失败 kind=${kind} stage=${stage} attempt=${attempt}`);
  failure.imageFailure = {
    kind,
    stage,
    attempt,
    elapsedMs,
    ...(transportCode ? { transportCode } : {}),
    ...(httpStatus ? { httpStatus } : {}),
    ...(providerRequestId ? { providerRequestId } : {}),
  } as ImageFailureDiagnostics;
  return failure;
};

/**
 * 明确收到、安全且文档化的临时拒绝才允许有限重试：
 * HTTP 429（限流）与“队列已满/繁忙”语义的 400。超时、连接重置、5xx 等
 * 供应商可能已收到并处理请求的不确定结果绝不自动重放 POST（Issue #39）。
 */
const isExplicitSafeTemporaryRejection = (error: any): boolean => {
  const status = Number(error?.response?.status || 0);
  if (status === 429) return true;
  if (status === 400) {
    return /busy|queue|concurr|rate|limit|frequent|频繁|并发|稍后/i.test(getImageResponseText(error));
  }
  return false;
};

const postImageWithSafeRetry = async (url: string, body: any, headers: any): Promise<any> => {
  const startedAt = Date.now();
  let lastError: any;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await axios.post(url, body, { headers, timeout: 360000, proxy: false });
    } catch (error: any) {
      lastError = error;
      if (attempt >= 3 || !isExplicitSafeTemporaryRejection(error)) {
        throw buildImageFailure(classifyImageRequestError(error), "generation", error, attempt, startedAt);
      }
      const waitMs = attempt * 3000;
      const status = Number(error?.response?.status || 0);
      logger(`[Agnes 图片] 供应商明确临时拒绝（HTTP ${status}），将在 ${waitMs / 1000} 秒后重试（${attempt}/3）`);
      await waitWithPollTask(waitMs);
    }
  }

  throw lastError;
};

const normalizeImageRatio = (ratio: string): string => {
  const supported = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"];
  return supported.includes(ratio) ? ratio : "1:1";
};

const getImage20Size = (size: ImageConfig["size"], ratio: string): string => {
  const dimensions: Record<string, Record<ImageConfig["size"], string>> = {
    "1:1": { "1K": "1024x1024", "2K": "2048x2048", "4K": "4096x4096" },
    "3:4": { "1K": "864x1152", "2K": "1728x2304", "4K": "3456x4608" },
    "4:3": { "1K": "1152x864", "2K": "2304x1728", "4K": "4608x3456" },
    "16:9": { "1K": "1312x736", "2K": "2624x1472", "4K": "5248x2944" },
    "9:16": { "1K": "736x1312", "2K": "1472x2624", "4K": "2944x5248" },
    "2:3": { "1K": "832x1248", "2K": "1664x2496", "4K": "3328x4992" },
    "3:2": { "1K": "1248x832", "2K": "2496x1664", "4K": "4992x3328" },
    "21:9": { "1K": "1568x672", "2K": "3136x1344", "4K": "6272x2688" },
  };
  return dimensions[ratio]?.[size] || dimensions["1:1"][size] || "1024x1024";
};

const ensureImageDataUri = (value: string): string => {
  if (value.startsWith("data:")) return value;
  return `data:image/png;base64,${value}`;
};

const getVideoDimensions = (resolution: string, ratio: "16:9" | "9:16"): { width: number; height: number } => {
  const normalized = String(resolution || "720p").toLowerCase();
  const landscape = normalized.includes("1080")
    ? { width: 1920, height: 1088 }
    : normalized.includes("480")
      ? { width: 832, height: 448 }
      : { width: 1280, height: 704 };
  return ratio === "9:16" ? { width: landscape.height, height: landscape.width } : landscape;
};

const getVideoFrames = (duration: number): number => {
  const seconds = Math.max(1, Math.min(18, Math.round(Number(duration) || 5)));
  const frameRate = 24;
  const n = Math.max(1, Math.min(55, Math.round((seconds * frameRate - 1) / 8)));
  return Math.min(441, n * 8 + 1);
};

const unwrapVideoData = (payload: any): any => {
  if (payload?.data && !Array.isArray(payload.data)) return payload.data;
  return payload;
};

const extractVideoUrl = (payload: any): string | undefined => {
  const data = unwrapVideoData(payload);
  return data?.metadata?.url || data?.url || data?.video_url || data?.output?.url;
};

const extractTaskError = (payload: any): string | undefined => {
  const data = unwrapVideoData(payload);
  const error = data?.error?.message || data?.error || data?.message || data?.msg;
  return error ? (typeof error === "string" ? error : JSON.stringify(error)) : undefined;
};

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel, think: boolean, _thinkLevel: 0 | 1 | 2 | 3) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 Agnes AI API Key");

  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");

  return createOpenAICompatible({
    name: "agnes",
    baseURL: getOpenAIBaseUrl(),
    apiKey,
    fetch: async (url: string, options?: any) => {
      if (!options?.body || typeof options.body !== "string") {
        return await fetch(url, options);
      }

      let rawBody: any;
      try {
        rawBody = JSON.parse(options.body);
      } catch {
        return await fetch(url, options);
      }

      const body = think
        ? {
            ...rawBody,
            chat_template_kwargs: {
              ...(rawBody.chat_template_kwargs || {}),
              enable_thinking: true,
            },
          }
        : rawBody;

      return await fetch(url, {
        ...options,
        body: JSON.stringify(body),
      });
    },
  }).chatModel(model.modelName);
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  const headers = getHeaders();
  const baseUrl = getBaseUrl();
  const ratio = normalizeImageRatio(config.aspectRatio || "1:1");
  const rawImageRefs = (config.referenceList || [])
    .map((item) => item.base64)
    .filter(Boolean)
    .map(ensureImageDataUri);
  const configuredLimit = Number(model.maxReferenceImages);
  const maxReferenceImages = Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : rawImageRefs.length;
  if (rawImageRefs.length > maxReferenceImages) {
    throw new TypeError(`Agnes ${model.modelName} accepts at most ${maxReferenceImages} reference images`);
  }
  const imageRefs = rawImageRefs;
  const isModernImage = model.modelName === "agnes-image-2.1-flash"
    || model.modelName === "agnes-image-2.5-flash";
  const body: any = {
    model: model.modelName,
    prompt: config.prompt || "",
    size: isModernImage ? config.size || "1K" : getImage20Size(config.size || "1K", ratio),
    return_base64: true,
    extra_body: {
      response_format: "b64_json",
    },
  };

  if (isModernImage) body.ratio = ratio;
  if (imageRefs.length > 0) body.extra_body.image = imageRefs;

  logger(`[Agnes 图片] 提交 ${model.modelName}，参考图 ${imageRefs.length} 张，尺寸 ${body.size}，比例 ${ratio}`);

  return await runImageRequestSerially(async (): Promise<string> => {
    // 只有获得本地串行执行槽后才宣告 generating；仍在队列中的请求保持等待中。
    if (config.onStage) await config.onStage("generating");
    // 本地日志只描述本地事实：请求即将从这里发出，不代表 Agnes 云端已接受
    logger(`[Agnes 图片] 开始本地供应商请求：${model.modelName}`);
    const requestStartedAt = Date.now();
    let response: any;
    try {
      response = await postImageWithSafeRetry(`${baseUrl}/v1/images/generations`, body, headers);
    } catch (error: any) {
      // 已携带结构化诊断的失败（含安全重试耗尽）原样上抛
      if (error?.imageFailure) throw error;
      throw buildImageFailure(classifyImageRequestError(error), "generation", error, 1, requestStartedAt);
    }
    const payload = response?.data;
    const item = Array.isArray(payload?.data) ? payload.data[0] : payload?.data?.[0] || payload;
    const b64 = item?.b64_json || payload?.b64_json;
    const url = item?.url || payload?.url;

    try {
      if (b64) return ensureImageDataUri(b64);
      if (url) {
        // 供应商返回 URL：媒体网络下载开始，通知调用方进入“下载中”
        if (config.onStage) await config.onStage("downloading");
        try {
          const downloaded = await urlToBase64(url);
          if (config.onStage) await config.onStage("downloaded");
          return downloaded;
        } catch (error: any) {
          throw buildImageFailure("downloadFailed", "download", error, 1, requestStartedAt);
        }
      }
      throw buildImageFailure(
        "noImageData",
        "generation",
        new Error(`响应中没有图片数据：${JSON.stringify(payload).slice(0, 200)}`),
        1,
        requestStartedAt,
      );
    } catch (error: any) {
      if (error?.imageFailure) throw error;
      throw buildImageFailure("transport", "generation", error, 1, requestStartedAt);
    }
  });
};

const videoRequest = async (config: VideoGenerationCommand, model: VideoModel): Promise<string> => {
  const headers = getHeaders();
  const baseUrl = getBaseUrl();
  const isVideo25 = model.modelName === "agnes-video-2.5-flash";
  if (isVideo25 && config.capabilityId === "keyframe-to-video") {
    throw new TypeError("Agnes Video 2.5 Flash does not support an intermediate keyframe");
  }
  const dimensions = getVideoDimensions(config.output.resolution, config.output.aspectRatio);
  const body: any = isVideo25
    ? { model: model.modelName, prompt: config.prompt,
      mode: config.capabilityId === "text-to-video" ? "text" : "keyframe",
      seconds: String(config.output.duration), size: "720P",
      aspect_ratio: config.output.aspectRatio, n: 1 }
    : { model: model.modelName, prompt: config.prompt,
      width: dimensions.width, height: dimensions.height,
      num_frames: getVideoFrames(config.output.duration), frame_rate: 24 };

  if (isVideo25 && config.capabilityId === "first-last-frame") {
    body.first_frame = ensureImageDataUri(config.firstFrame.base64);
    body.last_frame = ensureImageDataUri(config.lastFrame.base64);
  } else if (isVideo25 && config.capabilityId === "image-to-video") {
    body.first_frame = ensureImageDataUri(config.sourceImage.base64);
  } else if (config.capabilityId === "keyframe-to-video") {
    const keyframes = [config.firstFrame, config.intermediateKeyframe, config.lastFrame]
      .filter((image): image is ResolvedImage => !!image)
      .map((image) => ensureImageDataUri(image.base64));
    body.extra_body = {
      image: keyframes,
      mode: "keyframes",
    };
  } else if (config.capabilityId === "image-to-video") {
    body.image = ensureImageDataUri(config.sourceImage.base64);
  }

  let videoId = config.resumeTask?.videoId;
  let taskId = config.resumeTask?.taskId;
  let submitData: any;

  const checkpoint = async (stage: VideoTaskCheckpoint["stage"], retry: number): Promise<void> => {
    if (!config.onTaskCheckpoint) return;
    await config.onTaskCheckpoint({
      vendorId: "agnes",
      modelName: model.modelName,
      videoId,
      taskId,
      stage,
      retry,
    });
  };

  const downloadResult = async (resultUrl: string, retry: number): Promise<string> => {
    const maxDownloadRetries = 2;
    let downloadRetryCount = 0;

    while (true) {
      const currentRetry = retry + downloadRetryCount;
      await checkpoint("download", currentRetry);
      try {
        return await urlToBase64(resultUrl, { proxy: false, timeout: 120000 });
      } catch (error: any) {
        const message = formatVideoError("download", error, { videoId, taskId }, currentRetry);
        if (!isRetryableVideoTransportError(error) || downloadRetryCount >= maxDownloadRetries) {
          logger(message);
          throw new Error(message);
        }
        downloadRetryCount += 1;
        const waitMs = getVideoRetryBackoffMs(downloadRetryCount);
        logger(`${message} backoffMs=${waitMs}`);
        await sleep(waitMs);
      }
    }
  };

  if (!videoId && !taskId) {
    logger(
      `[Agnes 视频] 提交 ${config.capabilityId === "keyframe-to-video" || config.capabilityId === "first-last-frame" ? "关键帧" : config.capabilityId === "image-to-video" ? "图生视频" : "文生视频"}任务，${isVideo25 ? `${body.size}/${body.seconds}秒` : `${dimensions.width}x${dimensions.height}/${body.num_frames}帧`}`,
    );

    const maxQueueRetries = 4;
    let submitRetry = 0;
    while (true) {
      try {
        const submitResponse = await axios.post(`${baseUrl}/v1/videos`, body, {
          headers,
          timeout: 120000,
          proxy: false,
        });
        submitData = unwrapVideoData(submitResponse?.data);
        break;
      } catch (error: any) {
        if (!isExplicitQueueFullError(error) || submitRetry >= maxQueueRetries) {
          const message = formatVideoError("submit", error, {}, submitRetry);
          logger(message);
          throw new Error(message);
        }
        submitRetry += 1;
        const waitMs = getSubmitQueueBackoffMs(submitRetry);
        const message = formatVideoError("submit", error, {}, submitRetry);
        logger(`${message} backoffMs=${waitMs}`);
        await sleep(waitMs);
      }
    }

    videoId = submitData?.video_id;
    taskId = submitData?.task_id || submitData?.id;
    const directUrl = extractVideoUrl(submitData);
    if (directUrl && String(submitData?.status || "").toLowerCase() === "completed") {
      return await downloadResult(directUrl, 0);
    }
    if (!videoId && !taskId) {
      const message = formatVideoError(
        "submit",
        { message: `未返回 video_id 或 task_id。原始响应：${JSON.stringify(submitData).slice(0, 500)}` },
        {},
        0,
      );
      logger(message);
      throw new Error(message);
    }
    logger(`[Agnes 视频] 任务已创建：${videoId || taskId}`);
  } else {
    logger(`[Agnes 视频] 恢复已有任务：${videoId || taskId}`);
  }

  let pollRetryCount = Math.max(0, Number(config.resumeTask?.retry || 0));
  await checkpoint("poll", pollRetryCount);

  let consecutivePollRetries = 0;
  const maxPollRetries = 8;

  const queryTask = async (): Promise<any> => {
    if (videoId) {
      const query = `video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(model.modelName)}`;
      try {
        const response = await axios.get(`${baseUrl}/agnesapi?${query}`, {
          headers,
          timeout: 60000,
          proxy: false,
        });
        return response?.data;
      } catch (error: any) {
        if (!taskId || error?.response?.status !== 404) throw error;
      }
    }
    const response = await axios.get(`${baseUrl}/v1/videos/${encodeURIComponent(taskId)}`, {
      headers,
      timeout: 60000,
      proxy: false,
    });
    return response?.data;
  };

  const pollResult = await pollTask(
    async (): Promise<PollResult> => {
      let payload: any;

      while (true) {
        try {
          payload = await queryTask();
          consecutivePollRetries = 0;
          break;
        } catch (error: any) {
          if (!isRetryableVideoTransportError(error) || pollRetryCount >= maxPollRetries) {
            const message = formatVideoError("poll", error, { videoId, taskId }, pollRetryCount);
            logger(message);
            throw new Error(message);
          }
          pollRetryCount += 1;
          consecutivePollRetries += 1;
          const waitMs = getVideoRetryBackoffMs(consecutivePollRetries);
          const message = formatVideoError("poll", error, { videoId, taskId }, pollRetryCount);
          logger(`${message} backoffMs=${waitMs}`);
          await checkpoint("poll", pollRetryCount);
          await sleep(waitMs);
        }
      }

      const data = unwrapVideoData(payload);
      const status = String(data?.status || data?.state || "").toLowerCase();
      const url = extractVideoUrl(data);

      if (["completed", "succeeded", "success", "done"].includes(status)) {
        return url
          ? { completed: true, data: url }
          : {
              completed: true,
              error: formatVideoError(
                "poll",
                { message: "Agnes 视频任务已完成，但响应中没有 metadata.url" },
                { videoId, taskId },
                pollRetryCount,
              ),
            };
      }
      if (["failed", "error", "cancelled", "canceled", "expired"].includes(status)) {
        await checkpoint("failed", pollRetryCount);
        return {
          completed: true,
          error: formatVideoError(
            "poll",
            { message: extractTaskError(data) || "Agnes 视频生成失败", response: { data } },
            { videoId, taskId },
            pollRetryCount,
          ),
        };
      }
      if (url && !status) return { completed: true, data: url };
      return { completed: false };
    },
    5000,
    1800000,
  );

  if (pollResult.error) {
    throw new Error(
      pollResult.error.startsWith("[Agnes Video]")
        ? pollResult.error
        : formatVideoError("poll", { message: pollResult.error }, { videoId, taskId }, pollRetryCount),
    );
  }
  if (!pollResult.data) {
    throw new Error(
      formatVideoError("poll", { message: "轮询结束但没有返回视频地址" }, { videoId, taskId }, pollRetryCount),
    );
  }
  return await downloadResult(pollResult.data, pollRetryCount);
};

const ttsRequest = async (_config: TTSConfig, _model: TTSModel): Promise<string> => {
  return "";
};

const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return {
    hasUpdate: false,
    latestVersion: vendor.version,
    notice:
      "Agnes AI ToonFlow 供应商适配器 2.6：新增 Agnes 3.0/Text、Image 2.5 和 Video 2.5 Flash 模型，同时保留 V2.0 兼容路径。",
  };
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
