import { jsonSchema, tool } from "ai";
import { z } from "zod";

/**
 * Base Asset 提取的 provider-independent 契约（Issue #41）。
 *
 * 两个阶段共用同一套候选结构；模型输出在 AI SDK 工具入参 seam 或路由外
 * 的任意调用方处都被规范化为这里的 canonical 数组，再由编排模块做确定性
 * 校验、归并和排序。路由与 Vendor/Model 名称无关。
 *
 * Schema 面向 JSON Schema 的部分（工具入参描述）不携带 transform；裁剪、
 * 去空白等确定性规范化在解析成功后由 normalize 函数完成。
 */

export const BASE_ASSET_TYPES = ["role", "scene", "tool"] as const;
export type BaseAssetType = (typeof BASE_ASSET_TYPES)[number];

/** 原文摘录与场次/段落标识的确定性长度上限。 */
export const EVIDENCE_EXCERPT_MAX_LENGTH = 200;
export const EVIDENCE_LOCATOR_MAX_LENGTH = 100;
export const CANDIDATE_SUMMARY_MAX_LENGTH = 300;
export const CANDIDATE_ALIASES_MAX_COUNT = 20;
export const CANDIDATE_EVIDENCE_MAX_COUNT = 50;

/** 每类 Base Asset 允许携带的类型专属身份事实键；剧本未提供的信息必须为空。 */
export const IDENTITY_FACT_KEYS: Readonly<Record<BaseAssetType, readonly string[]>> = {
  role: ["gender", "ageBand", "occupation"],
  scene: ["geography", "spatialStructure", "landmark"],
  tool: ["material", "function"],
};

// ---------------------------------------------------------------------------
// Wire Schema：面向工具入参与 JSON Schema，不含 transform
// ---------------------------------------------------------------------------

const WireEvidenceSchema = z.object({
  scriptId: z.number().int(),
  excerpt: z.string().min(1),
  locator: z.string().min(1),
});

const WireCandidateSchema = z.object({
  type: z.enum(BASE_ASSET_TYPES),
  canonicalName: z.string().min(1),
  aliases: z.array(z.string().min(1)).max(CANDIDATE_ALIASES_MAX_COUNT),
  summary: z.string().min(1),
  scriptIds: z.array(z.number().int()).min(1),
  evidence: z.array(WireEvidenceSchema).min(1).max(CANDIDATE_EVIDENCE_MAX_COUNT),
  identityFacts: z.record(z.string(), z.string()).optional(),
});

export const BaseExtractionToolResultSchema = z.object({
  assets: z.array(WireCandidateSchema),
});

const WireFactAdditionSchema = z.object({
  type: z.enum(BASE_ASSET_TYPES),
  canonicalName: z.string().min(1),
  identityFacts: z.record(z.string(), z.string()),
  evidence: z.array(WireEvidenceSchema).min(1).max(CANDIDATE_EVIDENCE_MAX_COUNT),
});

const WireTypeCorrectionSchema = z.object({
  type: z.enum(BASE_ASSET_TYPES),
  canonicalName: z.string().min(1),
  newType: z.enum(BASE_ASSET_TYPES),
  evidence: z.array(WireEvidenceSchema).min(1).max(CANDIDATE_EVIDENCE_MAX_COUNT),
});

const WireAliasProposalSchema = z.object({
  type: z.enum(BASE_ASSET_TYPES),
  canonicalName: z.string().min(1),
  alias: z.string().min(1),
  evidence: z.array(WireEvidenceSchema).min(1).max(CANDIDATE_EVIDENCE_MAX_COUNT),
});

/**
 * 完整性审计只能：补充遗漏资产、补充稳定事实、修正类型、提议有证据的别名
 * 关系。契约层面不存在删除操作，多余字段在解析时被丢弃。
 */
export const CompletenessAuditToolResultSchema = z.object({
  additions: z.array(WireCandidateSchema),
  factAdditions: z.array(WireFactAdditionSchema),
  typeCorrections: z.array(WireTypeCorrectionSchema),
  aliasProposals: z.array(WireAliasProposalSchema),
});

// ---------------------------------------------------------------------------
// Canonical 类型：确定性规范化之后的结果
// ---------------------------------------------------------------------------

export interface AssetEvidence {
  scriptId: number;
  excerpt: string;
  locator: string;
}

export interface BaseAssetCandidate {
  type: BaseAssetType;
  canonicalName: string;
  aliases: string[];
  summary: string;
  scriptIds: number[];
  evidence: AssetEvidence[];
  identityFacts?: Record<string, string>;
}

export interface AuditFactAddition {
  type: BaseAssetType;
  canonicalName: string;
  identityFacts: Record<string, string>;
  evidence: AssetEvidence[];
}

export interface AuditTypeCorrection {
  type: BaseAssetType;
  canonicalName: string;
  newType: BaseAssetType;
  evidence: AssetEvidence[];
}

export interface AuditAliasProposal {
  type: BaseAssetType;
  canonicalName: string;
  alias: string;
  evidence: AssetEvidence[];
}

export interface BaseExtractionToolResult {
  assets: BaseAssetCandidate[];
}

export interface CompletenessAuditToolResult {
  additions: BaseAssetCandidate[];
  factAdditions: AuditFactAddition[];
  typeCorrections: AuditTypeCorrection[];
  aliasProposals: AuditAliasProposal[];
}

// ---------------------------------------------------------------------------
// 解析与规范化
// ---------------------------------------------------------------------------

function decodeJson(value: unknown, field: string): unknown {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const source = fenced?.[1] ?? trimmed;

  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`资产提取结果的 ${field} 不是有效 JSON`);
  }
}

function parseToolResult<T>(
  schema: z.ZodType<T>,
  input: unknown,
  label: string,
  arrayFields: readonly string[],
): T {
  const decodedInput = decodeJson(input, "工具参数");
  if (!decodedInput || typeof decodedInput !== "object" || Array.isArray(decodedInput)) {
    throw new Error(`${label}必须是对象`);
  }
  // 兼容把数组字段二次 JSON 序列化的 Model 输出：逐字段解码后再做强校验。
  const candidate = { ...(decodedInput as Record<string, unknown>) };
  for (const field of arrayFields) {
    if (typeof candidate[field] === "string") {
      candidate[field] = decodeJson(candidate[field], field);
    }
  }
  const result = schema.safeParse(candidate);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")).filter(Boolean))];
    throw new Error(`${label}格式无效：${fields.join("、") || "工具参数"}`);
  }
  return result.data;
}

function clampText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeEvidence(evidence: { scriptId: number; excerpt: string; locator: string }): AssetEvidence {
  return {
    scriptId: evidence.scriptId,
    excerpt: clampText(evidence.excerpt, EVIDENCE_EXCERPT_MAX_LENGTH),
    locator: clampText(evidence.locator, EVIDENCE_LOCATOR_MAX_LENGTH),
  };
}

/** 只保留该类型允许的身份事实键；未知键确定性丢弃，剧本未提供的信息保持为空。 */
export function normalizeIdentityFacts(
  type: BaseAssetType,
  facts: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!facts) return undefined;
  const allowed = new Set(IDENTITY_FACT_KEYS[type]);
  const normalized: Record<string, string> = {};
  for (const key of Object.keys(facts).sort()) {
    if (allowed.has(key)) normalized[key] = facts[key];
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

type WireCandidate = z.infer<typeof WireCandidateSchema>;

function normalizeCandidate(candidate: WireCandidate): BaseAssetCandidate {
  const canonicalName = candidate.canonicalName.trim();
  const identityFacts = normalizeIdentityFacts(candidate.type, candidate.identityFacts);
  return {
    type: candidate.type,
    canonicalName,
    aliases: [...new Set(candidate.aliases.map((alias) => alias.trim()).filter((alias) => alias && alias !== canonicalName))],
    summary: clampText(candidate.summary, CANDIDATE_SUMMARY_MAX_LENGTH),
    scriptIds: [...new Set(candidate.scriptIds)],
    evidence: candidate.evidence.map(normalizeEvidence),
    ...(identityFacts ? { identityFacts } : {}),
  };
}

export function parseBaseExtractionToolInput(input: unknown): BaseExtractionToolResult {
  const parsed = parseToolResult(BaseExtractionToolResultSchema, input, "基础资产提取结果", ["assets"]);
  return { assets: parsed.assets.map(normalizeCandidate) };
}

export function parseCompletenessAuditToolInput(input: unknown): CompletenessAuditToolResult {
  const parsed = parseToolResult(
    CompletenessAuditToolResultSchema,
    input,
    "完整性审计结果",
    ["additions", "factAdditions", "typeCorrections", "aliasProposals"],
  );
  return {
    additions: parsed.additions.map(normalizeCandidate),
    factAdditions: parsed.factAdditions.map((fact) => ({
      type: fact.type,
      canonicalName: fact.canonicalName.trim(),
      identityFacts: fact.identityFacts,
      evidence: fact.evidence.map(normalizeEvidence),
    })),
    typeCorrections: parsed.typeCorrections.map((correction) => ({
      type: correction.type,
      canonicalName: correction.canonicalName.trim(),
      newType: correction.newType,
      evidence: correction.evidence.map(normalizeEvidence),
    })),
    aliasProposals: parsed.aliasProposals.map((proposal) => ({
      type: proposal.type,
      canonicalName: proposal.canonicalName.trim(),
      alias: proposal.alias.trim(),
      evidence: proposal.evidence.map(normalizeEvidence),
    })),
  };
}

export const baseExtractionToolInputSchema = jsonSchema<unknown>(
  BaseExtractionToolResultSchema.toJSONSchema() as Record<string, unknown>,
);

export const completenessAuditToolInputSchema = jsonSchema<unknown>(
  CompletenessAuditToolResultSchema.toJSONSchema() as Record<string, unknown>,
);

/**
 * 捕获原始工具参数的 resultTool。规范化与校验由调用方在模型调用返回后执
 * 行，保证非法工具输出必然让整次运行失败，而不是被 SDK 吞成 tool-error。
 */
function createCapturingResultTool(inputSchema: ReturnType<typeof jsonSchema>, collect: (raw: unknown) => void) {
  return tool({
    description: "返回结果时必须调用这个工具，且只调用一次",
    inputSchema,
    execute: async (raw: unknown) => {
      collect(raw);
      return "无需回复用户任何内容";
    },
  });
}

export function createBaseExtractionResultTool(collect: (raw: unknown) => void) {
  return createCapturingResultTool(baseExtractionToolInputSchema, collect);
}

export function createCompletenessAuditResultTool(collect: (raw: unknown) => void) {
  return createCapturingResultTool(completenessAuditToolInputSchema, collect);
}
