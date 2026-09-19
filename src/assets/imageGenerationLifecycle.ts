import type { Knex } from "knex";

/**
 * 图片生成共享生命周期契约（Issue #39）。
 *
 * 单资产、批量生成与 Production Agent 资产生成共用同一状态机；状态只由
 * 后端真实事件驱动并持久化在 o_image.state，任何页面都不得手写字符串：
 *
 *   等待中：批量请求已被后端接受，但任务尚未获得本地并发槽。
 *   生成中：已经开始调用 Image Vendor。
 *   下载中：供应商返回图片 URL，Toonflow 开始下载媒体。
 *   已完成：图片已持久化并绑定资产。
 *   生成失败：任一阶段稳定失败（含超时、下载失败、写入失败、进程中断）。
 *   已取消：用户主动取消；供应商迟到结果不得覆盖该终态。
 *
 * Base64 响应直接跳过“下载中”；本地文件或 OSS 写入不是网络下载，
 * 不进入“下载中”。禁止用前端定时器、延时或百分比模拟进度。
 */
export const IMAGE_GENERATION_LIFECYCLE_STATES = [
  "等待中",
  "生成中",
  "下载中",
  "已完成",
  "生成失败",
  "已取消",
] as const;

export type ImageGenerationLifecycleState = (typeof IMAGE_GENERATION_LIFECYCLE_STATES)[number];

/** 仍可能推进到其他状态的非终态（fixDB 重启恢复与条件更新都以此判定）。 */
export const IMAGE_GENERATION_ACTIVE_STATES: readonly ImageGenerationLifecycleState[] = [
  "等待中",
  "生成中",
  "下载中",
];

export const IMAGE_GENERATION_TERMINAL_STATES: readonly ImageGenerationLifecycleState[] = [
  "已完成",
  "生成失败",
  "已取消",
];

export function isImageGenerationActiveState(state: unknown): state is ImageGenerationLifecycleState {
  return typeof state === "string" && (IMAGE_GENERATION_ACTIVE_STATES as readonly string[]).includes(state);
}

export function isImageGenerationTerminalState(state: unknown): state is ImageGenerationLifecycleState {
  return typeof state === "string" && (IMAGE_GENERATION_TERMINAL_STATES as readonly string[]).includes(state);
}

/** 供应商结构化失败分类（适配器 → 领域，决定稳定 failure kind）。 */
export type VendorImageFailureKind = "timeout" | "transport" | "httpError" | "noImageData" | "downloadFailed";

export interface VendorImageFailureDiagnostics {
  kind: VendorImageFailureKind;
  stage: "generation" | "download";
  attempt: number;
  elapsedMs?: number;
  transportCode?: string;
  httpStatus?: number;
  providerRequestId?: string;
}

/**
 * 供应商图片失败：适配器以 `error.imageFailure` 携带白名单诊断（VM 边界
 * 只传输普通对象），默认依赖负责将其包装为本类型再交给领域分类。
 */
export class VendorImageGenerationError extends Error {
  readonly diagnostics: VendorImageFailureDiagnostics;

  constructor(diagnostics: VendorImageFailureDiagnostics) {
    super(`供应商图片生成失败 kind=${diagnostics.kind} stage=${diagnostics.stage}`);
    this.name = "VendorImageGenerationError";
    this.diagnostics = sanitizeVendorImageFailureDiagnostics(diagnostics);
  }
}

const DIAGNOSTIC_TEXT_LIMIT = 200;
const BASE64_LIKE_RUN = /[A-Za-z0-9+/]{80,}={0,2}/g;
const URL_WITH_SIGNATURE = /https?:\/\/\S*(signature|token|key|expires)=\S*/gi;
const ANY_URL = /https?:\/\/\S+/g;
const SAFE_DIAGNOSTIC_IDENTIFIER = /^[A-Za-z0-9._:-]+$/;

/** 诊断文本脱敏：截断、移除 base64 长串与（可能带签名的）URL。 */
export function sanitizeDiagnosticText(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value
    .replace(URL_WITH_SIGNATURE, "[signed-url-redacted]")
    .replace(BASE64_LIKE_RUN, "[redacted]")
    .replace(ANY_URL, "[url-redacted]")
    .slice(0, DIAGNOSTIC_TEXT_LIMIT);
}

function sanitizeDiagnosticIdentifier(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().slice(0, limit);
  return normalized && SAFE_DIAGNOSTIC_IDENTIFIER.test(normalized) ? normalized : undefined;
}

/** 白名单字段 + 标量截断：任何来源的诊断在持久化前都必须经过本函数。 */
export function sanitizeVendorImageFailureDiagnostics(
  diagnostics: VendorImageFailureDiagnostics,
): VendorImageFailureDiagnostics {
  const attempt = Number.isFinite(diagnostics?.attempt) ? Math.max(1, Math.floor(Number(diagnostics.attempt))) : 1;
  const httpStatus =
    Number.isInteger((diagnostics as { httpStatus?: unknown })?.httpStatus) &&
    Number((diagnostics as { httpStatus?: unknown }).httpStatus) > 0
      ? Number((diagnostics as { httpStatus?: unknown }).httpStatus)
      : undefined;
  const elapsedMs =
    Number.isFinite((diagnostics as { elapsedMs?: unknown })?.elapsedMs) &&
    Number((diagnostics as { elapsedMs?: unknown }).elapsedMs) >= 0
      ? Math.floor(Number((diagnostics as { elapsedMs?: unknown }).elapsedMs))
      : undefined;
  const stage = diagnostics?.stage === "download" ? "download" : "generation";
  const kind: VendorImageFailureKind = (
    ["timeout", "transport", "httpError", "noImageData", "downloadFailed"] as const
  ).includes(diagnostics?.kind)
    ? diagnostics.kind
    : "transport";
  return {
    kind,
    stage,
    attempt,
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    ...(sanitizeDiagnosticIdentifier(diagnostics?.transportCode, 64)
      ? { transportCode: sanitizeDiagnosticIdentifier(diagnostics.transportCode, 64) }
      : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(sanitizeDiagnosticIdentifier(diagnostics?.providerRequestId, 128)
      ? { providerRequestId: sanitizeDiagnosticIdentifier(diagnostics.providerRequestId, 128) }
      : {}),
  };
}

/** 取消也属于共享状态机：只允许活跃态一次性迁移到“已取消”。 */
export async function cancelImageGeneration(db: Knex, imageId: number): Promise<boolean> {
  const updated = await db("o_image")
    .where("id", imageId)
    .whereIn("state", [...IMAGE_GENERATION_ACTIVE_STATES])
    .update({ state: "已取消" });
  return Number(updated) > 0;
}

const TIMEOUT_MESSAGE_PATTERN = /timeout of \d+ms exceeded|request timed ?out|ETIMEDOUT|ECONNABORTED/i;

/**
 * 超时分类兜底：供应商适配器未携带结构化诊断时，按稳定消息特征把网络
 * 超时与普通失败区分开（结果不确定的超时绝不自动重放）。
 */
export function isTimeoutLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyError = error as { code?: unknown; message?: unknown };
  if (anyError.code === "ETIMEDOUT" || anyError.code === "ECONNABORTED") return true;
  return typeof anyError.message === "string" && TIMEOUT_MESSAGE_PATTERN.test(anyError.message);
}

/** 从任意供应商错误中提取结构化诊断（类型化错误或 `error.imageFailure`）；没有时返回 null。 */
export function extractVendorImageFailure(error: unknown): VendorImageFailureDiagnostics | null {
  if (error instanceof VendorImageGenerationError) return error.diagnostics;
  if (!error || typeof error !== "object") return null;
  const candidate = (error as { imageFailure?: unknown }).imageFailure;
  if (!candidate || typeof candidate !== "object") return null;
  const raw = candidate as Partial<VendorImageFailureDiagnostics>;
  if (typeof raw.kind !== "string") return null;
  return sanitizeVendorImageFailureDiagnostics(raw as VendorImageFailureDiagnostics);
}

/** 供应商失败诊断 → 稳定 failure kind（超时/下载失败与普通失败分别展示）。 */
export type StableImageGenerationFailureKind =
  | "imageGenerationTimeout"
  | "imageDownloadFailed"
  | "imageGenerationFailed";

export function classifyVendorImageFailure(error: unknown): StableImageGenerationFailureKind {
  const diagnostics = extractVendorImageFailure(error);
  if (diagnostics) {
    if (diagnostics.kind === "timeout") return "imageGenerationTimeout";
    if (diagnostics.kind === "downloadFailed") return "imageDownloadFailed";
    return "imageGenerationFailed";
  }
  return isTimeoutLikeError(error) ? "imageGenerationTimeout" : "imageGenerationFailed";
}

const INTERRUPTED_IMAGE_REASON = "软件退出导致失败";

/**
 * 进程重启恢复（Issue #39）：非终态（等待中/生成中/下载中）的图片任务
 * 在启动时统一落为“生成失败”。图片生成没有可恢复的供应商任务 ID，
 * 不尝试自动续跑；用户通过既有重试入口重新提交。
 */
export async function failInterruptedImageGenerations(db: Knex): Promise<void> {
  await db("o_image")
    .whereIn("state", [...IMAGE_GENERATION_ACTIVE_STATES])
    .update({
      state: "生成失败",
      errorReason: INTERRUPTED_IMAGE_REASON,
    });
}

/** 轮询响应使用的稳定失败 kind：`errorReason` 形如 `kind:hash` 时取前缀。 */
export function imageFailureKindFromStoredReason(reason: unknown): string | null {
  if (typeof reason !== "string" || !reason) return null;
  const match = /^([a-zA-Z]+):/.exec(reason);
  return match ? match[1] : null;
}

/** 轮询单条记录的权威状态（各路由自行映射图片 URL 的展示字段）。 */
export interface ImageGenerationPollingRow {
  state: string | null;
  filePath: string | null;
  prompt: string | null;
  errorKind: string | null;
}

/**
 * 轮询查询共享形状（/assets/pollingImageAssets 与
 * /production/assets/pollingImage 共用）：o_assets 左联 o_image，
 * 对每个请求的资产 id 都生成一条记录；资产或图片记录缺失时各字段为
 * null（前端必须停止等待），绝不因 SQL 过滤或省略行导致永久等待。
 */
export async function readImageGenerationPollingRows(
  db: Knex,
  ids: readonly number[],
): Promise<Map<number, ImageGenerationPollingRow>> {
  const rows: unknown[] = await db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .whereIn("o_assets.id", [...ids])
    .select("o_assets.id", "o_assets.prompt", "o_image.state", "o_image.filePath", "o_image.errorReason");
  const byAssetId = new Map<number, any>(rows.map((row: any) => [Number(row.id), row] as [number, any]));
  const result = new Map<number, ImageGenerationPollingRow>();
  for (const id of ids) {
    const row = byAssetId.get(id);
    result.set(id, {
      state: row?.state ?? null,
      filePath: row?.filePath ?? null,
      prompt: row?.prompt ?? null,
      errorKind: imageFailureKindFromStoredReason(row?.errorReason),
    });
  }
  return result;
}
