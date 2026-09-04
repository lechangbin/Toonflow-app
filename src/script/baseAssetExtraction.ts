import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { stepCountIs } from "ai";
import type { Knex } from "knex";

import type { DatabaseWork } from "@/database";
import { getDatabaseRuntime } from "@/database";
import { getDefaultConfiguredVendor } from "@/vendor";
import getPath from "@/utils/getPath";

import {
  BASE_ASSET_TYPES,
  createBaseExtractionResultTool,
  createCompletenessAuditResultTool,
  normalizeIdentityFacts,
  parseBaseExtractionToolInput,
  parseCompletenessAuditToolInput,
  type AssetEvidence,
  type AuditFactAddition,
  type AuditAliasProposal,
  type AuditTypeCorrection,
  type BaseAssetCandidate,
  type BaseAssetType,
  type CompletenessAuditToolResult,
} from "./assetExtractionContract";

/**
 * Base Asset 双阶段提取编排模块（Issue #41）。
 *
 * 一次运行 = 恰好两次全上下文 Text Model 调用：
 *   1. 基础资产提取（data/skills/asset-extraction/prompts/base_asset_extraction.md）
 *   2. 完整性审计（…/base_asset_completeness_review.md），只能补充遗漏、补充
 *      稳定事实、修正类型、提议有证据的别名，不能删除候选、不能产生 Derived Asset。
 *
 * 校验、归并、排序全部由本模块的确定性代码完成；两次调用复用任务开始时解
 * 析出的同一个配置 Text Model 目标。模块返回完整 staged result，`persistBa-
 * seAssetExtraction` 在单个数据库租约内的一个事务中一次性写入最终结果，供
 * #44 在一个事务中执行替换式重新提取。路由只是薄适配器。
 */

export const ASSET_IDENTITY_SCHEMA_VERSION = 1;

const EXTRACTION_TEMPLATE_PATH = "prompts/base_asset_extraction.md";
const AUDIT_TEMPLATE_PATH = "prompts/base_asset_completeness_review.md";

/** Base Scene / Base Asset 状态变体命名使用的分隔符；命中即折叠回基础资产。 */
const VARIANT_SEPARATORS = ["·", "・", "：", ":", "（", "(", "—", "－"] as const;

const TYPE_ORDER: Record<BaseAssetType, number> = { role: 0, scene: 1, tool: 2 };
const TYPE_LABELS: Record<BaseAssetType, string> = { role: "角色", scene: "场景", tool: "道具" };

export type BaseAssetExtractionFailureKind =
  | "scriptNotFound"
  | "extractionInProgress"
  | "reextractConfirmationRequired"
  | "skillContractMissing"
  | "modelCallFailed"
  | "modelOutputMissing"
  | "malformedOutput"
  | "invalidOutput"
  | "persistenceFailed";

export class BaseAssetExtractionFailure extends Error {
  readonly kind: BaseAssetExtractionFailureKind;

  constructor(kind: BaseAssetExtractionFailureKind, message: string) {
    super(message);
    this.name = "BaseAssetExtractionFailure";
    this.kind = kind;
  }
}

export interface BaseAssetModelCall {
  system: string;
  user: string;
  tools: Record<string, unknown>;
}

/** 一次运行内复用的 Text Model 调用句柄；目标在打开时解析一次。 */
export interface BaseAssetTextCall {
  invoke(input: BaseAssetModelCall): Promise<void>;
}

export interface BaseAssetExtractionDependencies {
  work: DatabaseWork;
  /** 解析一次配置 Text Model 目标；基础提取与完整性审计共用返回的句柄。 */
  openTextCall(): Promise<BaseAssetTextCall>;
  /** 从 data/skills/asset-extraction 加载版本控制模板；缺失返回 null。 */
  loadSkillFile(relativePath: string): Promise<string | null>;
  now(): number;
  /** 结构化日志：阶段、剧本 ID、数量、稳定错误类型与安全的歧义元数据。 */
  log(entry: Record<string, unknown>): void;
}

export interface BaseAssetExtractionInput {
  projectId: number;
  scriptIds: readonly number[];
}

export interface StagedBaseAsset {
  type: BaseAssetType;
  canonicalName: string;
  aliases: string[];
  summary: string;
  scriptIds: number[];
  evidence: AssetEvidence[];
  identityFacts?: Record<string, string>;
  /** 剧本时间线上第一次明确可视出场。 */
  baseline: AssetEvidence;
  /** 供旧前端使用的确定性编译摘要，写入 o_assets.describe。 */
  describe: string;
}

export interface StagedBaseAssetExtraction {
  projectId: number;
  scriptIds: number[];
  candidates: StagedBaseAsset[];
}

export interface ScriptRecord {
  id: number;
  name: string | null;
  content: string | null;
  projectId: number;
}

export interface CompletenessAuditOperations {
  additions: BaseAssetCandidate[];
  factAdditions: AuditFactAddition[];
  typeCorrections: AuditTypeCorrection[];
  aliasProposals: AuditAliasProposal[];
}

interface WorkingCandidate {
  type: BaseAssetType;
  canonicalName: string;
  aliases: Set<string>;
  summary: string;
  scriptIds: Set<number>;
  evidence: AssetEvidence[];
  identityFacts: Record<string, string>;
}

/** 归并阶段的结构化日志上下文：临时 requestId + 安全的歧义元数据出口。 */
interface MergeLogContext {
  requestId?: string;
  log: (entry: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// 阶段一 + 阶段二：staged result（不写库）
// ---------------------------------------------------------------------------

export async function runBaseAssetExtraction(
  dependencies: BaseAssetExtractionDependencies,
  input: BaseAssetExtractionInput,
): Promise<StagedBaseAssetExtraction> {
  const scripts = await resolveScripts(dependencies, input);
  if (!scripts.length) {
    throw new BaseAssetExtractionFailure("scriptNotFound", "未找到属于当前项目的可提取剧本");
  }
  return runBaseAssetExtractionWithScripts(dependencies, scripts);
}

export async function runBaseAssetExtractionWithScripts(
  dependencies: BaseAssetExtractionDependencies,
  scripts: ScriptRecord[],
): Promise<StagedBaseAssetExtraction> {
  if (!scripts.length) {
    throw new BaseAssetExtractionFailure("scriptNotFound", "未找到属于当前项目的可提取剧本");
  }
  const requestId = randomUUID();
  const projectId = scripts[0].projectId;
  const selectedIds = new Set(scripts.map((script) => script.id));
  const scriptContentById = new Map(scripts.map((script) => [script.id, script.content ?? ""]));
  const scriptsContent = compileScriptsContent(scripts);
  const call = await dependencies.openTextCall();

  // ---- 阶段一：一次基础资产提取调用 ----
  const extractionPrompt = await requireSkillFile(dependencies, EXTRACTION_TEMPLATE_PATH);
  let extractionRaw: unknown = undefined;
  await invokeStage(call, {
    system: extractionPrompt,
    user: `请根据以下 ${scripts.length} 集剧本提取全部 Base Asset（角色、场景、道具）：\n\n${scriptsContent}`,
    tools: { resultTool: createBaseExtractionResultTool((raw) => (extractionRaw = raw)) },
  });
  if (extractionRaw === undefined) {
    throw new BaseAssetExtractionFailure("modelOutputMissing", "基础资产提取未返回工具结果");
  }
  const extractionResult = parseWithFailure(
    () => parseBaseExtractionToolInput(extractionRaw),
    "基础资产提取结果",
  );
  const candidates = validateCandidates(extractionResult.assets, selectedIds, scriptContentById);
  dependencies.log({ requestId, stage: "extraction", scriptIds: [...selectedIds], count: candidates.length });

  // ---- 阶段二：一次完整性审计调用 ----
  const auditPrompt = await requireSkillFile(dependencies, AUDIT_TEMPLATE_PATH);
  let auditRaw: unknown = undefined;
  await invokeStage(call, {
    system: auditPrompt,
    user: [
      `以下是一次 Base Asset 提取的候选清单，以及全部 ${scripts.length} 集剧本原文。`,
      "请对照剧本原文做完整性审计：补充遗漏资产、补充稳定事实、修正类型、提议有证据的别名关系。",
      "不得删除任何已有候选，不得输出任何派生状态资产。",
      "",
      "【候选清单】",
      compileCandidateDigest(candidates),
      "",
      "【剧本原文】",
      scriptsContent,
    ].join("\n"),
    tools: { resultTool: createCompletenessAuditResultTool((raw) => (auditRaw = raw)) },
  });
  if (auditRaw === undefined) {
    throw new BaseAssetExtractionFailure("modelOutputMissing", "完整性审计未返回工具结果");
  }
  const audit = parseWithFailure(() => parseCompletenessAuditToolInput(auditRaw), "完整性审计结果");
  const operations = validateAuditOperations(audit, selectedIds, scriptContentById);
  dependencies.log({
    requestId,
    stage: "audit",
    scriptIds: [...selectedIds],
    additions: operations.additions.length,
    factAdditions: operations.factAdditions.length,
    typeCorrections: operations.typeCorrections.length,
    aliasProposals: operations.aliasProposals.length,
  });

  // ---- 确定性归并与排序 ----
  const merged = mergeBaseAssetCandidates(candidates, operations, {
    requestId,
    log: dependencies.log,
  });
  dependencies.log({ requestId, stage: "merge", scriptIds: [...selectedIds], count: merged.length });

  return {
    projectId,
    scriptIds: [...selectedIds],
    candidates: merged,
  };
}

// ---------------------------------------------------------------------------
// 确定性归并：导出的纯函数，供聚焦测试与 #44 复用
// ---------------------------------------------------------------------------

export function mergeBaseAssetCandidates(
  candidates: BaseAssetCandidate[],
  operations: CompletenessAuditOperations,
  context: MergeLogContext,
): StagedBaseAsset[] {
  const working: WorkingCandidate[] = candidates.map(toWorkingCandidate);

  // 主提取内部的同名/别名重复：确定性归并。
  mergeWorkingList(working, context);
  foldStateVariants(working, context);

  // 审计操作按固定顺序应用：修正类型 → 别名提议 → 稳定事实 → 补充遗漏。
  for (const correction of operations.typeCorrections) {
    const target = findCandidate(working, correction.type, correction.canonicalName);
    if (!target) {
      throw new BaseAssetExtractionFailure(
        "invalidOutput",
        `完整性审计的类型修正指向不存在的候选：${correction.canonicalName}`,
      );
    }
    if (target.type !== correction.newType) {
      target.type = correction.newType;
      target.identityFacts = normalizeIdentityFacts(target.type, target.identityFacts) ?? {};
    }
  }

  for (const proposal of operations.aliasProposals) {
    const target = findCandidate(working, proposal.type, proposal.canonicalName);
    if (!target) {
      throw new BaseAssetExtractionFailure(
        "invalidOutput",
        `完整性审计的别名提议指向不存在的候选：${proposal.canonicalName}`,
      );
    }
    if (proposal.alias === target.canonicalName) continue;
    const collision = working.find((c) => c !== target && c.type === target.type && c.canonicalName === proposal.alias);
    if (collision) {
      context.log({
        requestId: context.requestId,
        stage: "merge",
        kind: "identityAmbiguous",
        reason: "aliasCollidesWithCandidate",
        type: target.type,
        name: proposal.alias,
        scriptIds: [...collision.scriptIds],
      });
      continue;
    }
    target.aliases.add(proposal.alias);
  }

  for (const fact of operations.factAdditions) {
    const target = findCandidate(working, fact.type, fact.canonicalName);
    if (!target) {
      throw new BaseAssetExtractionFailure(
        "invalidOutput",
        `完整性审计的事实补充指向不存在的候选：${fact.canonicalName}`,
      );
    }
    const normalized = normalizeIdentityFacts(target.type, fact.identityFacts) ?? {};
    for (const [key, value] of Object.entries(normalized)) {
      const existing = target.identityFacts[key];
      if (existing !== undefined && existing !== value) {
        throw new BaseAssetExtractionFailure(
          "invalidOutput",
          `完整性审计的事实补充与已有事实冲突：${fact.canonicalName}.${key}`,
        );
      }
    }
    Object.assign(target.identityFacts, normalized);
    target.evidence.push(...fact.evidence);
  }

  const additions = operations.additions.map(toWorkingCandidate);
  for (const addition of additions) {
    const links = working.filter(
      (candidate) =>
        candidate.type === addition.type &&
        (candidate.canonicalName === addition.canonicalName ||
          candidate.aliases.has(addition.canonicalName) ||
          addition.aliases.has(candidate.canonicalName)),
    );
    if (links.length === 0) {
      working.push(addition);
      continue;
    }
    if (links.length > 1) {
      context.log({
        requestId: context.requestId,
        stage: "merge",
        kind: "identityAmbiguous",
        reason: "multipleIdentityLinks",
        type: addition.type,
        name: addition.canonicalName,
        scriptIds: [...addition.scriptIds],
      });
      working.push(addition);
      continue;
    }
    const link = links[0];
    const sameCanonicalName = link.canonicalName === addition.canonicalName;
    const intersects = [...link.scriptIds].some((id) => addition.scriptIds.has(id));
    if (sameCanonicalName && !intersects) {
      // 同名但剧本证据不相交：不确定身份，保持两个候选。
      context.log({
        requestId: context.requestId,
        stage: "merge",
        kind: "identityAmbiguous",
        reason: "sameNameDisjointScriptIds",
        type: addition.type,
        name: addition.canonicalName,
        scriptIds: [...addition.scriptIds],
      });
      working.push(addition);
      continue;
    }
    mergeInto(link, addition);
  }

  foldStateVariants(working, context);

  return working
    .map((candidate) => toStagedBaseAsset(candidate))
    .sort((a, b) => compareCodePoints(a.canonicalName, b.canonicalName))
    .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
}

// ---------------------------------------------------------------------------
// 一次性持久化：单个数据库租约内的一个事务完成全部写入
// ---------------------------------------------------------------------------

export interface PersistedBaseAssetExtraction {
  assetIds: number[];
}

/** staged 结果的确定性持久化明细：复用的既有资产与新建资产分开返回。 */
export interface PersistedStagedBaseAssets {
  assetIds: number[];
  reusedAssetIds: number[];
  createdAssetIds: number[];
}

/**
 * 在调用方提供的事务内持久化 staged 结果：复用证据支持的既有身份、新建资
 * 产、重建所选剧本的关联。不提交事务，也不负责孤儿清理（见 #44 替换模块）。
 */
export async function persistStagedBaseAssets(
  trx: Knex,
  dependencies: BaseAssetExtractionDependencies,
  staged: StagedBaseAssetExtraction,
): Promise<PersistedStagedBaseAssets> {
  const existingAssets = await trx("o_assets").where("projectId", staged.projectId).select("id", "name", "type");
  const existingIdentities = existingAssets.length
    ? await trx("o_assetIdentity").whereIn(
        "assetsId",
        existingAssets.map((asset) => asset.id),
      )
    : [];
  const identityByAssetId = new Map<number, BaseAssetIdentityRecord>();
  for (const row of existingIdentities) {
    try {
      const record = parseBaseAssetIdentityRecord(row.identity);
      identityByAssetId.set(row.assetsId, record);
    } catch {
      // 损坏或缺失的身份记录没有足够证据支持自动复用。
    }
  }

  const assetIds: number[] = [];
  const reusedAssetIds: number[] = [];
  const createdAssetIds: number[] = [];
  const consumedAssetIds = new Set<number>();
  for (const candidate of staged.candidates) {
    const matched = existingAssets.find((asset) => {
      if (consumedAssetIds.has(asset.id)) return false;
      const identity = identityByAssetId.get(asset.id);
      return identity ? identitiesAreLinked(identity, candidate) : false;
    });
    if (!matched) {
      const ambiguous = existingAssets.find((asset) => {
        const identity = identityByAssetId.get(asset.id);
        return (
          !consumedAssetIds.has(asset.id) &&
          asset.type === candidate.type &&
          identity?.canonicalName === candidate.canonicalName
        );
      });
      if (ambiguous) {
        dependencies.log({
          stage: "persist",
          kind: "identityAmbiguous",
          reason: "sameNameWithoutEvidenceLink",
          type: candidate.type,
          name: candidate.canonicalName,
          existingAssetId: ambiguous.id,
          scriptIds: candidate.scriptIds,
        });
      }
    }
    if (matched) {
      consumedAssetIds.add(matched.id);
      // 提取管理的资产（已有身份记录）刷新确定性编译摘要；人工创建或
      // 修改过的资产（无身份记录）保持原 describe，只补写身份记录。
      if (identityByAssetId.has(matched.id)) {
        await trx("o_assets").where("id", matched.id).update({ describe: candidate.describe });
      }
      await upsertAssetIdentity(trx, dependencies, matched.id, staged.projectId, candidate);
      assetIds.push(matched.id);
      reusedAssetIds.push(matched.id);
      continue;
    }
    const [assetId] = await trx("o_assets").insert({
      name: candidate.canonicalName,
      type: candidate.type,
      describe: candidate.describe,
      projectId: staged.projectId,
      startTime: dependencies.now(),
    });
    await upsertAssetIdentity(trx, dependencies, assetId, staged.projectId, candidate);
    assetIds.push(assetId);
    createdAssetIds.push(assetId);
  }

  // 新剧本的最终结果一次性重建关联，不逐组写入。
  await trx("o_scriptAssets").whereIn("scriptId", staged.scriptIds).delete();
  const linkRows = new Map<string, { scriptId: number; assetId: number }>();
  staged.candidates.forEach((candidate, index) => {
    for (const scriptId of candidate.scriptIds) {
      const assetId = assetIds[index];
      linkRows.set(`${scriptId}_${assetId}`, { scriptId, assetId });
    }
  });
  if (linkRows.size) await trx("o_scriptAssets").insert([...linkRows.values()]);

  return { assetIds, reusedAssetIds, createdAssetIds };
}

export async function persistBaseAssetExtraction(
  dependencies: BaseAssetExtractionDependencies,
  staged: StagedBaseAssetExtraction,
): Promise<PersistedBaseAssetExtraction> {
  try {
    const { assetIds } = await dependencies.work((db) =>
      db.transaction(async (trx) => persistStagedBaseAssets(trx, dependencies, staged)),
    );
    return { assetIds };
  } catch (error) {
    throw new BaseAssetExtractionFailure("persistenceFailed", `Base Asset 结果写入失败: ${errorMessage(error)}`);
  }
}

// ---------------------------------------------------------------------------
// 确认门禁 + 原子占用：替换式重新提取的唯一入口状态检查（#44）
// ---------------------------------------------------------------------------

export type ScriptAssetExtractionClaim =
  | { status: "claimed"; scripts: ScriptRecord[] }
  | { status: "reextractConfirmationRequired" }
  | { status: "extractionInProgress" }
  | { status: "scriptNotFound" };

export interface ScriptAssetExtractionClaimInput {
  projectId: number;
  scriptIds: readonly number[];
  /** 显式替换意图；缺少时任意选中剧本已有关联资产即拒绝（HTTP 409）。 */
  replaceExisting?: boolean;
}

/**
 * 同步完成两件事（一个事务）：
 *   1. 后端权威的重新提取确认——所选剧本存在资产关联且缺少 replaceExisting
 *      时返回 reextractConfirmationRequired，不执行模型调用、不改变数据库状态。
 *   2. 原子占用全部剧本（extractState → 0），并发请求只有一个成功。
 */
export async function claimScriptAssetExtraction(
  dependencies: BaseAssetExtractionDependencies,
  input: ScriptAssetExtractionClaimInput,
): Promise<ScriptAssetExtractionClaim> {
  const scripts = await resolveScripts(dependencies, input);
  if (!scripts.length) return { status: "scriptNotFound" };
  const scriptIds = scripts.map((script) => script.id);

  const claim = await dependencies.work((db) =>
    db
      .transaction(async (trx): Promise<ClaimOutcome> => {
        if (!input.replaceExisting) {
          const linked = await trx("o_scriptAssets").whereIn("scriptId", scriptIds).select("scriptId");
          if (linked.length) throw new ReextractConfirmationRequired();
        }
        const updated = await trx("o_script")
          .whereIn("id", scriptIds)
          .where((builder) => builder.whereNull("extractState").orWhereNot("extractState", 0))
          .update({ extractState: 0 });
        if (Number(updated) === scriptIds.length) return true;
        throw new ExtractionClaimConflict();
      })
      .catch((error: unknown): ClaimOutcome => {
        if (error instanceof ReextractConfirmationRequired) return "reextractConfirmationRequired";
        if (error instanceof ExtractionClaimConflict) return "extractionInProgress";
        throw error;
      }),
  );
  if (claim !== true) return { status: claim };
  return { status: "claimed", scripts };
}

type ClaimOutcome = true | "reextractConfirmationRequired" | "extractionInProgress";

class ExtractionClaimConflict extends Error {}
class ReextractConfirmationRequired extends Error {}

// ---------------------------------------------------------------------------
// 生产环境依赖
// ---------------------------------------------------------------------------

export function createDefaultBaseAssetSkillFileLoader() {
  return async (relativePath: string): Promise<string | null> => {
    const filePath = getPath(["skills", "asset-extraction", ...relativePath.split("/")]);
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  };
}

export function createDefaultBaseAssetExtractionDependencies(): BaseAssetExtractionDependencies {
  return {
    work: (operation) => getDatabaseRuntime().work(operation),
    openTextCall: async () => {
      // 任务开始时解析一次配置 Text Model 目标，两次调用共用同一句柄。
      const call = await getDefaultConfiguredVendor().openTextCall({ kind: "logical", key: "universalAi" });
      return {
        invoke: async ({ system, user, tools }) => {
          await call.invokeText({
            system,
            messages: [{ role: "user", content: user }],
            tools: tools as Parameters<typeof call.invokeText>[0]["tools"],
            stopWhen: stepCountIs(1),
          });
        },
      };
    },
    loadSkillFile: createDefaultBaseAssetSkillFileLoader(),
    now: () => Date.now(),
    log: (entry) => console.log(`[baseAssetExtraction] ${JSON.stringify(entry)}`),
  };
}

// ---------------------------------------------------------------------------
// 身份记录读写
// ---------------------------------------------------------------------------

export interface BaseAssetIdentityRecord {
  schemaVersion: number;
  type: BaseAssetType;
  canonicalName: string;
  aliases: string[];
  summary: string;
  scriptIds: number[];
  evidence: AssetEvidence[];
  identityFacts?: Record<string, string>;
  baseline: AssetEvidence;
}

export function parseBaseAssetIdentityRecord(serialized: unknown): BaseAssetIdentityRecord {
  const record = JSON.parse(typeof serialized === "string" ? serialized : "{}") as BaseAssetIdentityRecord;
  if (!record || typeof record !== "object" || !record.canonicalName) {
    throw new Error("Base Asset 身份记录无效");
  }
  return record;
}

function identitiesAreLinked(existing: BaseAssetIdentityRecord, candidate: StagedBaseAsset): boolean {
  if (existing.type !== candidate.type) return false;
  const existingAliases = new Set(existing.aliases ?? []);
  const candidateAliases = new Set(candidate.aliases);
  const sameCanonicalName = existing.canonicalName === candidate.canonicalName;
  const hasExplicitNameAliasLink =
    existingAliases.has(candidate.canonicalName) || candidateAliases.has(existing.canonicalName);
  if (!sameCanonicalName && !hasExplicitNameAliasLink) return false;

  const existingScriptIds = new Set(existing.scriptIds ?? []);
  if (candidate.scriptIds.some((scriptId) => existingScriptIds.has(scriptId))) return true;
  if (hasExplicitNameAliasLink) return true;

  // 跨剧本同规范名不能只靠名称复用；至少需要一个一致的结构化身份事实，且
  // 已有事实之间不能冲突。通用称号的 alias 交集不构成身份链接。
  const existingFacts = existing.identityFacts ?? {};
  const candidateFacts = candidate.identityFacts ?? {};
  const sharedKeys = Object.keys(existingFacts).filter((key) => candidateFacts[key] !== undefined);
  if (sharedKeys.some((key) => existingFacts[key] !== candidateFacts[key])) return false;
  return sharedKeys.some((key) => existingFacts[key] === candidateFacts[key]);
}

async function upsertAssetIdentity(
  db: Knex,
  dependencies: BaseAssetExtractionDependencies,
  assetsId: number,
  projectId: number,
  candidate: StagedBaseAsset,
): Promise<void> {
  const record: BaseAssetIdentityRecord = {
    schemaVersion: ASSET_IDENTITY_SCHEMA_VERSION,
    type: candidate.type,
    canonicalName: candidate.canonicalName,
    aliases: candidate.aliases,
    summary: candidate.summary,
    scriptIds: candidate.scriptIds,
    evidence: candidate.evidence,
    ...(candidate.identityFacts ? { identityFacts: candidate.identityFacts } : {}),
    baseline: candidate.baseline,
  };
  const existing = await db("o_assetIdentity").where("assetsId", assetsId).first();
  if (existing) {
    await db("o_assetIdentity")
      .where("assetsId", assetsId)
      .update({
        schemaVersion: ASSET_IDENTITY_SCHEMA_VERSION,
        identity: JSON.stringify(record),
        updateTime: dependencies.now(),
      });
    return;
  }
  await db("o_assetIdentity").insert({
    assetsId,
    projectId,
    schemaVersion: ASSET_IDENTITY_SCHEMA_VERSION,
    identity: JSON.stringify(record),
    createTime: dependencies.now(),
    updateTime: dependencies.now(),
  });
}

// ---------------------------------------------------------------------------
// 内部实现
// ---------------------------------------------------------------------------

async function resolveScripts(
  dependencies: BaseAssetExtractionDependencies,
  input: BaseAssetExtractionInput,
): Promise<ScriptRecord[]> {
  const ids = [...new Set(input.scriptIds)];
  if (!ids.length) return [];
  const scripts = await dependencies.work((db) =>
    db("o_script").whereIn("id", ids).where("projectId", input.projectId).select("id", "name", "content", "projectId"),
  );
  return scripts.sort((a, b) => a.id - b.id);
}

/** 阶段调用的统一错误包装：模型调用失败映射为稳定的 modelCallFailed。 */
async function invokeStage(call: BaseAssetTextCall, input: BaseAssetModelCall): Promise<void> {
  try {
    await call.invoke(input);
  } catch (error) {
    if (error instanceof BaseAssetExtractionFailure) throw error;
    throw new BaseAssetExtractionFailure("modelCallFailed", `Text Model 调用失败: ${errorMessage(error)}`);
  }
}

function compileScriptsContent(scripts: ScriptRecord[]): string {
  return scripts
    .map(({ id, name, content }) => `===== 【剧本ID: ${id}】${name || ""} =====\n${content || ""}`)
    .join("\n\n");
}

function compileCandidateDigest(candidates: BaseAssetCandidate[]): string {
  return candidates
    .map((candidate, index) =>
      [
        `候选${index + 1}: type=${candidate.type} canonicalName=${candidate.canonicalName}`,
        `  aliases: ${candidate.aliases.length ? candidate.aliases.join("、") : "无"}`,
        `  scriptIds: ${candidate.scriptIds.join(",")}`,
        `  summary: ${candidate.summary}`,
        ...candidate.evidence.map((evidence) => `  evidence: scriptId=${evidence.scriptId} locator=${evidence.locator}`),
      ].join("\n"),
    )
    .join("\n");
}

async function requireSkillFile(
  dependencies: BaseAssetExtractionDependencies,
  relativePath: string,
): Promise<string> {
  const content = await dependencies.loadSkillFile(relativePath);
  if (!content || !content.trim()) {
    throw new BaseAssetExtractionFailure("skillContractMissing", `资产提取技能模板缺失：${relativePath}`);
  }
  return content;
}

function parseWithFailure<T>(parse: () => T, label: string): T {
  try {
    return parse();
  } catch (error) {
    throw new BaseAssetExtractionFailure("malformedOutput", `${label}非法: ${errorMessage(error)}`);
  }
}

function validateCandidates(
  candidates: BaseAssetCandidate[],
  selectedIds: Set<number>,
  scriptContentById: ReadonlyMap<number, string>,
): BaseAssetCandidate[] {
  for (const candidate of candidates) {
    const unknown = [
      ...candidate.scriptIds,
      ...candidate.evidence.map((evidence) => evidence.scriptId),
    ].filter((id) => !selectedIds.has(id));
    if (unknown.length) {
      throw new BaseAssetExtractionFailure(
        "invalidOutput",
        `资产 ${candidate.canonicalName} 引用了未知剧本 ID：${[...new Set(unknown)].join(",")}`,
      );
    }
    const evidenceScriptIds = new Set(candidate.evidence.map((evidence) => evidence.scriptId));
    const missingEvidence = candidate.scriptIds.filter((id) => !evidenceScriptIds.has(id));
    if (missingEvidence.length) {
      throw new BaseAssetExtractionFailure(
        "invalidOutput",
        `资产 ${candidate.canonicalName} 的剧本 ${missingEvidence.join(",")} 缺少证据`,
      );
    }
    validateEvidenceExcerpts(`资产 ${candidate.canonicalName}`, candidate.evidence, scriptContentById);
  }
  return candidates;
}

function validateEvidenceExcerpts(
  label: string,
  evidence: readonly AssetEvidence[],
  scriptContentById: ReadonlyMap<number, string>,
): void {
  for (const item of evidence) {
    const content = scriptContentById.get(item.scriptId);
    if (content === undefined) continue;
    const normalizedExcerpt = normalizeEvidenceText(item.excerpt);
    if (!normalizedExcerpt || !normalizeEvidenceText(content).includes(normalizedExcerpt)) {
      throw new BaseAssetExtractionFailure(
        "invalidOutput",
        `${label}的证据摘录不存在于剧本 ${item.scriptId} 原文中`,
      );
    }
  }
}

function normalizeEvidenceText(value: string): string {
  return value.replace(/\s+/gu, "");
}

function validateAuditOperations(
  audit: CompletenessAuditToolResult,
  selectedIds: Set<number>,
  scriptContentById: ReadonlyMap<number, string>,
): CompletenessAuditOperations {
  const validatedAdditions = validateCandidates(audit.additions, selectedIds, scriptContentById);

  const requireKnownScriptIds = (label: string, evidence: AssetEvidence[]) => {
    for (const item of evidence) {
      if (!selectedIds.has(item.scriptId)) {
        throw new BaseAssetExtractionFailure("invalidOutput", `${label}引用了未知剧本 ID：${item.scriptId}`);
      }
    }
    validateEvidenceExcerpts(label, evidence, scriptContentById);
  };

  // 重复与冲突的审计操作直接拒绝：同一候选被同类操作命中两次、或同一候选
  // 同时被类型修正与事实/别名操作命中，语义不确定，不允许静默覆盖。
  const correctionKeys = new Set<string>();
  for (const correction of audit.typeCorrections) {
    const key = auditKey(correction.type, correction.canonicalName);
    if (correctionKeys.has(key)) {
      throw new BaseAssetExtractionFailure("invalidOutput", `完整性审计对同一候选重复修正类型：${correction.canonicalName}`);
    }
    correctionKeys.add(key);
    if (correction.type === correction.newType) {
      throw new BaseAssetExtractionFailure("invalidOutput", `完整性审计的类型修正是无操作：${correction.canonicalName}`);
    }
    requireKnownScriptIds("类型修正", correction.evidence);
  }

  const factKeys = new Set<string>();
  for (const fact of audit.factAdditions) {
    const key = auditKey(fact.type, fact.canonicalName);
    if (factKeys.has(key)) {
      throw new BaseAssetExtractionFailure("invalidOutput", `完整性审计对同一候选重复补充事实：${fact.canonicalName}`);
    }
    if (correctionKeys.has(key)) {
      throw new BaseAssetExtractionFailure(
        "invalidOutput",
        `完整性审计的类型修正与事实补充冲突：${fact.canonicalName}`,
      );
    }
    factKeys.add(key);
    requireKnownScriptIds("事实补充", fact.evidence);
  }

  const aliasKeys = new Set<string>();
  for (const proposal of audit.aliasProposals) {
    const key = auditKey(proposal.type, proposal.canonicalName);
    const dedupeKey = `${key}|${proposal.alias}`;
    if (aliasKeys.has(dedupeKey)) {
      throw new BaseAssetExtractionFailure("invalidOutput", `完整性审计对同一候选重复提议别名：${proposal.alias}`);
    }
    if (correctionKeys.has(key)) {
      throw new BaseAssetExtractionFailure(
        "invalidOutput",
        `完整性审计的类型修正与别名提议冲突：${proposal.canonicalName}`,
      );
    }
    aliasKeys.add(dedupeKey);
    requireKnownScriptIds("别名提议", proposal.evidence);
  }

  return {
    additions: validatedAdditions,
    factAdditions: audit.factAdditions,
    typeCorrections: audit.typeCorrections,
    aliasProposals: audit.aliasProposals,
  };
}

function auditKey(type: BaseAssetType, canonicalName: string): string {
  return `${type}:${canonicalName}`;
}

function toWorkingCandidate(candidate: BaseAssetCandidate): WorkingCandidate {
  return {
    type: candidate.type,
    canonicalName: candidate.canonicalName,
    aliases: new Set(candidate.aliases.filter((alias) => alias !== candidate.canonicalName)),
    summary: candidate.summary,
    scriptIds: new Set(candidate.scriptIds),
    evidence: [...candidate.evidence],
    identityFacts: normalizeIdentityFacts(candidate.type, candidate.identityFacts) ?? {},
  };
}

function findCandidate(
  working: WorkingCandidate[],
  type: BaseAssetType,
  canonicalName: string,
): WorkingCandidate | undefined {
  return working.find((candidate) => candidate.type === type && candidate.canonicalName === canonicalName);
}

/** 同类型内同名/别名关联的确定性归并：同名需剧本证据相交，别名声明直接合并。 */
function mergeWorkingList(
  working: WorkingCandidate[],
  context: MergeLogContext,
): void {
  for (let index = 0; index < working.length; index += 1) {
    const current = working[index];
    const links = working
      .map((candidate, position) => ({ candidate, position }))
      .filter(
        ({ candidate, position }) =>
          position !== index &&
          candidate.type === current.type &&
          (candidate.canonicalName === current.canonicalName ||
            candidate.aliases.has(current.canonicalName) ||
            current.aliases.has(candidate.canonicalName)),
      );
    if (links.length === 0) continue;
    if (links.length > 1) {
      context.log({
        requestId: context.requestId,
        stage: "merge",
        kind: "identityAmbiguous",
        reason: "multipleIdentityLinks",
        type: current.type,
        name: current.canonicalName,
        scriptIds: [...current.scriptIds],
      });
      continue;
    }
    const link = links[0];
    const sameCanonicalName = link.candidate.canonicalName === current.canonicalName;
    const intersects = [...link.candidate.scriptIds].some((id) => current.scriptIds.has(id));
    if (sameCanonicalName && !intersects) {
      context.log({
        requestId: context.requestId,
        stage: "merge",
        kind: "identityAmbiguous",
        reason: "sameNameDisjointScriptIds",
        type: current.type,
        name: current.canonicalName,
        scriptIds: [...current.scriptIds],
      });
      continue;
    }
    // 归并方向确定：列表中更早出现的候选存活，保持结果稳定。
    const survivorIsCurrent = index < link.position;
    const [survivor, removed] = survivorIsCurrent ? [current, link.candidate] : [link.candidate, current];
    mergeInto(survivor, removed);
    const removedPosition = survivorIsCurrent ? link.position : index;
    working.splice(removedPosition, 1);
    if (removedPosition < index) index -= 1;
  }
}

function mergeInto(
  target: WorkingCandidate,
  source: WorkingCandidate,
  includeSourceNameAsAlias = true,
): void {
  if (includeSourceNameAsAlias) target.aliases.add(source.canonicalName);
  for (const alias of source.aliases) target.aliases.add(alias);
  target.aliases.delete(target.canonicalName);
  for (const id of source.scriptIds) target.scriptIds.add(id);
  target.evidence.push(...source.evidence);
  Object.assign(target.identityFacts, source.identityFacts);
  if (!target.summary && source.summary) target.summary = source.summary;
}

/**
 * 状态变体折叠：canonicalName 是同类型另一候选的 canonicalName + 分隔符 +
 * 后缀（如 大泽乡 + · + 雨夜）时，视为同一 Base Asset 的派生状态命名，折叠
 * 回基础候选，不在本阶段产生 Derived Asset。
 */
function foldStateVariants(
  working: WorkingCandidate[],
  context: MergeLogContext,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < working.length; index += 1) {
      const current = working[index];
      const base = working.find(
        (candidate, position) =>
          position !== index && candidate.type === current.type && isVariantNameOf(current.canonicalName, candidate.canonicalName),
      );
      if (!base) continue;
      context.log({
        requestId: context.requestId,
        stage: "merge",
        kind: "stateVariantFolded",
        type: current.type,
        name: current.canonicalName,
        baseName: base.canonicalName,
      });
      // 派生状态命名不进入别名表，只合并证据与剧本归属。
      mergeInto(base, current, false);
      working.splice(index, 1);
      index -= 1;
      changed = true;
    }
  }
}

function isVariantNameOf(name: string, baseName: string): boolean {
  for (const separator of VARIANT_SEPARATORS) {
    const separatorIndex = baseName.length;
    if (
      name.length > separatorIndex + 1 &&
      name[separatorIndex] === separator &&
      name.startsWith(baseName)
    ) {
      return true;
    }
  }
  return false;
}

function toStagedBaseAsset(candidate: WorkingCandidate): StagedBaseAsset {
  const evidence = dedupeEvidence(candidate.evidence).sort((a, b) => {
    if (a.scriptId !== b.scriptId) return a.scriptId - b.scriptId;
    return 0; // 稳定排序保持同剧本内的原始出现顺序
  });
  const identityFacts = normalizeIdentityFacts(candidate.type, candidate.identityFacts);
  const typeLabel = TYPE_LABELS[candidate.type];
  const aliases = [...candidate.aliases].sort(compareCodePoints);
  const aliasPart = aliases.length ? `（又称：${aliases.join("、")}）` : "";
  return {
    type: candidate.type,
    canonicalName: candidate.canonicalName,
    aliases,
    summary: candidate.summary,
    scriptIds: [...candidate.scriptIds].sort((a, b) => a - b),
    evidence,
    ...(identityFacts ? { identityFacts } : {}),
    baseline: evidence[0],
    describe: `【${typeLabel}】${candidate.canonicalName}${aliasPart}：${candidate.summary}`,
  };
}

function dedupeEvidence(evidence: AssetEvidence[]): AssetEvidence[] {
  const seen = new Set<string>();
  const result: AssetEvidence[] = [];
  for (const item of evidence) {
    const key = `${item.scriptId}|${item.excerpt}|${item.locator}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
