import fs from "node:fs";
import { Knex } from "knex";

import type { DatabaseWork } from "@/database";
import { getDatabaseRuntime } from "@/database";
import { getDefaultConfiguredVendor } from "@/vendor";
import getPath from "@/utils/getPath";
import { getAllArtPrompts, getArtPrompt } from "@/utils/getArtPrompt";

import { ASSET_REFERENCE_LIMIT, listAssetReferences, type AssetReferenceRecord } from "./assetReferences";
import { sha256 } from "./contentHash";
import {
  assetPromptFailure,
  canonicalAssetBriefType,
  parseAnalysisOutput,
  parseReferenceRowId,
  presentedReferenceLabel,
  referenceBindingId,
  validateAssetBriefBatch,
  type AssetBrief,
  type AssetBriefBatch,
  type AssetBriefType,
  type AssetPromptFailure,
  type AssetPromptFailureKind,
  type AssetPromptResult,
  type ExpectedAssetInput,
} from "./assetBriefContract";
import {
  AGNES_IMAGE_2_1_FLASH_PROFILE,
  compileAssetGenerationPrompt,
  type AssetPromptModelProfile,
} from "./assetPromptCompiler";
import { resolveDerivedAssetGenerationEntry, type DerivedParentAnchor } from "./derivedAssetPrompt";

/**
 * Asset prompt orchestration 深模块（Issue #33）。
 *
 * 一次批量请求 = 至多一次 Text Model 调用：
 *   完整 Script + 项目上下文 + 选中资产 + 父资产事实 + 人工参考契约
 *   →（加载 #29 的 batch_asset_analysis.md 模板与 asset-brief.schema.json）
 *   → 严格 JSON Asset Brief 批次 → Schema 校验与有限修复
 *   → 参考契约绑定 → 按类型编译最终中文 generationPrompt
 *   → 持久化版本与来源哈希（稳定复用 + 输入变化即失效）。
 *
 * HTTP 路由只做薄适配；模板加载、模型调用、校验、失效与编译都在本模块内。
 * 失败路径永不覆盖最后一个有效 Brief 或最终 prompt。
 */

export const ASSET_PROMPTING_SKILL_VERSION = "asset-prompting@1.0";

const ANALYSIS_TEMPLATE_PATH = "prompts/batch_asset_analysis.md";
const OUTPUT_SCHEMA_PATH = "references/asset-brief.schema.json";

/** 当前按 Agnes Image 2.1 Flash 的能力验证与展示；Image 2.5 Flash 暂不启用。 */
const DEFAULT_MODEL_PROFILE: AssetPromptModelProfile = AGNES_IMAGE_2_1_FLASH_PROFILE;

/** 稳定错误信封：kind → 状态码/文案成对映射，模型原始异常不进入响应。 */
export const ASSET_PROMPT_FAILURE_ENVELOPE: Record<AssetPromptFailureKind, { status: number; message: string }> = {
  invalidRequest: { status: 400, message: "请求参数不合法" },
  projectNotFound: { status: 404, message: "项目不存在" },
  assetNotFound: { status: 404, message: "资产不存在" },
  assetProjectMismatch: { status: 403, message: "资产不属于该项目" },
  unsupportedAssetType: { status: 400, message: "资产类型不受支持" },
  scriptNotFound: { status: 404, message: "剧本不存在" },
  visualManualMissing: { status: 500, message: "视觉手册未定义" },
  skillContractMissing: { status: 500, message: "资产提示词技能契约缺失" },
  malformedOutput: { status: 502, message: "模型输出不符合 Asset Brief Schema" },
  missingAssetResult: { status: 502, message: "模型输出缺失了部分资产" },
  duplicateAssetResult: { status: 502, message: "模型输出包含重复资产" },
  unknownAssetResult: { status: 502, message: "模型输出包含未知资产" },
  assetTypeMismatch: { status: 502, message: "模型输出的资产类型与数据库不一致" },
  derivedMismatch: { status: 502, message: "模型输出的衍生身份与数据库不一致" },
  referenceBindingMismatch: { status: 502, message: "模型输出的参考图绑定与人工契约不一致" },
  analysisFailed: { status: 502, message: "批量资产分析调用失败" },
  languageProfileNotAvailable: { status: 400, message: "请求的语言 profile 尚未启用" },
  promptNotGenerated: { status: 409, message: "资产尚未生成提示词，请先生成提示词" },
  stalePromptRecord: { status: 409, message: "资产提示词已过期，请重新生成提示词" },
  referenceLimitExceeded: { status: 400, message: `单个资产最多支持 ${ASSET_REFERENCE_LIMIT} 张参考图` },
  derivedAssetReferenceForbidden: { status: 400, message: "衍生资产不支持人工参考图" },
  parentAssetMissing: { status: 404, message: "父资产不存在" },
  parentAssetAnchorMissing: { status: 409, message: "父资产缺少已接受的图像锚点" },
  parentAssetAnchorUnauthorized: { status: 403, message: "父资产不属于当前项目" },
  parentAssetAnchorUnreadable: { status: 500, message: "父资产锚点图片缺失或无法读取" },
  derivedChangeInstructionMissing: { status: 409, message: "衍生资产缺少变化契约，请重新执行衍生分析" },
  derivedChangeInstructionInvalid: { status: 500, message: "衍生资产变化契约非法" },
  derivedPromptCompilationFailed: { status: 500, message: "衍生资产提示词编译失败" },
};

export function assetPromptErrorEnvelope(failure: AssetPromptFailure): {
  status: number;
  body: { code: number; data: null; message: string; error: AssetPromptFailureKind };
} {
  const envelope = ASSET_PROMPT_FAILURE_ENVELOPE[failure.kind] ?? { status: 500, message: "资产提示词生成失败" };
  return {
    status: envelope.status,
    body: {
      code: envelope.status,
      data: null,
      message: envelope.message,
      error: failure.kind,
    },
  };
}

export interface AssetPromptOrchestrationDependencies {
  work: DatabaseWork;
  /** 唯一的 Text Model seam：输入 system/user，返回原始模型输出。 */
  analyze(input: { system: string; user: string }): Promise<unknown>;
  /** 从 data/skills/asset-prompting 加载模板/Schema；缺失返回 null。 */
  loadSkillFile(relativePath: string): Promise<string | null>;
  /** 项目美术风格前缀（prefix.md）；无风格时返回 null。 */
  getArtStylePrefix(artStyle: string | null | undefined): Promise<string | null>;
  /** 按手册键（art_character/art_scene/art_prop 及 _derivative）加载类型视觉手册；缺失返回 null。 */
  getVisualManual(artStyle: string, manualKey: string): Promise<string | null>;
  now(): number;
}

export interface GenerateBatchAssetPromptsInput {
  projectId: number;
  assetsIds: readonly number[];
  otherTextPrompt?: string | null;
}

export interface GeneratedAssetPromptEntry {
  assetsId: number;
  generationPrompt: string;
  reused: boolean;
  validationState: "validated" | "repaired";
}

export interface BatchAssetPromptsResult {
  entries: GeneratedAssetPromptEntry[];
  modelCalls: number;
}

interface TypedAssetRow {
  id: number;
  name: string | null;
  type: string | null;
  describe: string | null;
  assetsId: number | null;
  scriptId: number | null;
  projectId: number;
  /** 父资产行携带当前选定的图像锚点；基础资产行可不加载。 */
  imageId?: number | null;
  briefType: AssetBriefType;
}

interface GenerationContext {
  project: { id: number; name: string | null; type: string | null; intro: string | null; artStyle: string | null };
  assets: TypedAssetRow[];
  parentById: Map<
    number,
    { id: number; name: string; describe: string | null; imageId: number | null; projectId: number; assetsId: number | null }
  >;
  parentRows: TypedAssetRow[];
  scripts: { id: number; name: string | null; content: string | null }[];
  referencesByAsset: Map<number, AssetReferenceRecord[]>;
}

/** 数据库资产行 → 带 Brief 规范类型的行（role/scene/tool 别名在此收敛）。 */
function toTypedAssetRow(row: {
  id: number;
  name: string | null;
  type: string | null;
  describe: string | null;
  assetsId: number | null;
  scriptId: number | null;
  projectId: number;
  imageId?: number | null;
}): TypedAssetRow {
  return { ...row, briefType: canonicalAssetBriefType(row.type) as AssetBriefType };
}

/** 单资产类型涉及的视觉手册键（衍生资产附加 _derivative）。 */
function assetManualKeys(asset: TypedAssetRow): string[] {
  return [visualManualKey(asset.briefType, asset.assetsId != null)];
}

/**
 * 单资产上下文哈希：项目事实 + 该资产的剧本 + 该资产事实 + 父资产事实 + 额外
 * 要求 + 该资产类型涉及的视觉手册。哈希只覆盖单个资产自身的失效输入，与批量
 * 请求选中了哪些其他资产无关，因此单个与批量生成可以用同一入口做确定性的
 * 新鲜度判定（文档化失效契约：Script/模板/资产/父资产/参考契约）。
 */
function computeAssetContextHash(input: {
  context: GenerationContext;
  asset: TypedAssetRow;
  visualManuals: Map<string, string>;
  otherTextPrompt: string | null;
}): string {
  const { context, asset } = input;
  const script = context.scripts.find((row) => row.id === asset.scriptId) ?? null;
  const parent = asset.assetsId != null ? context.parentById.get(asset.assetsId) ?? null : null;
  const manuals = assetManualKeys(asset)
    .filter((manualKey) => input.visualManuals.has(manualKey))
    .map((manualKey) => ({ manualKey, content: input.visualManuals.get(manualKey)! }));
  return sha256(
    JSON.stringify({
      project: {
        artStyle: context.project.artStyle,
        type: context.project.type,
        intro: context.project.intro,
      },
      script: script ? { id: script.id, content: script.content } : null,
      asset: {
        id: asset.id,
        name: asset.name,
        briefType: asset.briefType,
        describe: asset.describe,
        assetsId: asset.assetsId,
        scriptId: asset.scriptId,
      },
      parent: parent ? { id: parent.id, name: parent.name, describe: parent.describe } : null,
      additionalRequirements: input.otherTextPrompt,
      visualManuals: manuals,
    }),
  );
}

/** 单资产参考契约哈希：该资产参考图 id/顺序/人工描述/视觉角色/必传要素/排除项。 */
function computeAssetReferenceHash(asset: TypedAssetRow, context: GenerationContext): string {
  return sha256(
    JSON.stringify(
      (context.referencesByAsset.get(asset.id) ?? []).map((reference) => ({
        id: reference.id,
        orderIndex: reference.orderIndex,
        description: reference.description,
        visualRole: reference.visualRole,
        requiredTransfers: reference.requiredTransfers,
        exclusions: reference.exclusions,
      })),
    ),
  );
}

function normalizeOtherTextPrompt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseAssetsIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids: number[] = [];
  for (const item of value) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** 兼容旧批量接口请求体：items[].assetsId 别名收敛、otherTextPrompt 可缺省、重复资产去重。 */
export function normalizeBatchPromptRequest(
  body: unknown,
): AssetPromptResult<{ projectId: number; assetsIds: number[]; otherTextPrompt: string | null }> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const projectId = Number(raw.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return { ok: false, failure: assetPromptFailure("invalidRequest", "projectId 不合法") };
  }
  const items = Array.isArray(raw.items) ? raw.items : [];
  const assetsIds: number[] = [];
  for (const item of items) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const id = Number(entry.assetsId);
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, failure: assetPromptFailure("invalidRequest", "items[].assetsId 不合法") };
    }
    if (!assetsIds.includes(id)) assetsIds.push(id);
  }
  if (assetsIds.length === 0) {
    return { ok: false, failure: assetPromptFailure("invalidRequest", "items 不能为空") };
  }
  return { ok: true, value: { projectId, assetsIds, otherTextPrompt: normalizeOtherTextPrompt(raw.otherTextPrompt) } };
}

async function loadGenerationContext(
  dependencies: AssetPromptOrchestrationDependencies,
  projectId: number,
  assetsIds: readonly number[],
): Promise<AssetPromptResult<GenerationContext>> {
  const base = await dependencies.work(async (db) => {
    const project = await db("o_project").where("id", projectId).first();
    if (!project) return { ok: false as const, failure: assetPromptFailure("projectNotFound", "项目不存在") };

    const rows = await db("o_assets")
      .whereIn("id", assetsIds)
      .select("id", "name", "type", "describe", "assetsId", "scriptId", "projectId");
    const expectedIds = new Set(assetsIds);
    if (rows.length !== expectedIds.size) {
      return { ok: false as const, failure: assetPromptFailure("assetNotFound", "部分资产不存在") };
    }
    for (const row of rows) {
      if (row.projectId !== projectId) {
        return {
          ok: false as const,
          failure: assetPromptFailure("assetProjectMismatch", `资产 ${row.id} 不属于该项目`),
        };
      }
    }
    const assets: TypedAssetRow[] = rows.map(toTypedAssetRow);
    const unsupported = assets.find((row) => !row.briefType);
    if (unsupported) {
      return {
        ok: false as const,
        failure: assetPromptFailure("unsupportedAssetType", `资产 ${unsupported.id} 的类型 ${unsupported.type} 不受支持`),
      };
    }

    const parentIds = [...new Set(assets.map((row) => row.assetsId).filter((id): id is number => id != null))];
    const parentRows: TypedAssetRow[] = parentIds.length
      ? (
          await db("o_assets")
            .whereIn("id", parentIds)
            .select("id", "name", "type", "describe", "assetsId", "scriptId", "projectId", "imageId")
        ).map(toTypedAssetRow)
      : [];
    if (parentRows.length !== parentIds.length) {
      return { ok: false as const, failure: assetPromptFailure("parentAssetMissing", "衍生资产的父资产不存在") };
    }
    const parentById = new Map(
      parentRows.map((row) => [
        row.id,
        {
          id: row.id,
          name: row.name ?? "",
          describe: row.describe,
          imageId: row.imageId ?? null,
          projectId: row.projectId,
          assetsId: row.assetsId ?? null,
        },
      ]),
    );

    const scriptIds = [...new Set(assets.map((row) => row.scriptId).filter((id): id is number => id != null))];
    const scripts: { id: number; name: string | null; content: string | null }[] = scriptIds.length
      ? await db("o_script").whereIn("id", scriptIds).select("id", "name", "content")
      : [];
    if (scripts.length !== scriptIds.length) {
      return { ok: false as const, failure: assetPromptFailure("scriptNotFound", "部分资产关联的剧本不存在") };
    }

    return { ok: true as const, value: { project, assets, parentRows, parentById, scripts } };
  });
  if (!base.ok) return base;

  const referencesByAsset = new Map<number, AssetReferenceRecord[]>();
  for (const asset of base.value.assets) {
    const listed = await listAssetReferences(dependencies.work, { projectId, assetsId: asset.id });
    if (!listed.ok) return { ok: false, failure: assetPromptFailure("assetNotFound", "资产参考图加载失败") };
    referencesByAsset.set(asset.id, listed.value);
  }
  return { ok: true, value: { ...base.value, referencesByAsset } };
}

function renderAnalysisUserInput(input: {
  project: GenerationContext["project"];
  scripts: GenerationContext["scripts"];
  assets: TypedAssetRow[];
  parentRows: TypedAssetRow[];
  referencesByAsset: Map<number, AssetReferenceRecord[]>;
  outputSchema: string;
  visualManuals: Map<string, string>;
}): string {
  const project = input.project;
  const sections: string[] = [];
  sections.push(
    [
      "## PROJECT_CONTEXT",
      `- 项目名称：${project.name ?? ""}`,
      `- 项目类型：${project.type ?? ""}`,
      `- 项目简介：${project.intro ?? ""}`,
      "- 语言：zh-CN",
      `- 美术风格标识：${project.artStyle ?? ""}`,
    ].join("\n"),
  );
  if (input.visualManuals.size > 0) {
    const manualText = [...input.visualManuals.entries()]
      .map(([manualKey, content]) => `### ${manualKey}\n${content}`)
      .join("\n\n");
    sections.push(`## VISUAL_MANUAL\n${manualText}`);
  }
  const scriptText = input.scripts.length
    ? input.scripts.map((script) => `### 剧本 ${script.id}：${script.name ?? ""}\n${script.content ?? ""}`).join("\n\n")
    : "（本批资产未关联剧本）";
  sections.push(`## FULL_SCRIPT\n${scriptText}`);
  const assetLines = input.assets.map(
    (asset) =>
      `- assetsId: ${asset.id} | type: ${asset.briefType} | name: ${asset.name ?? ""} | 描述: ${asset.describe ?? ""} | isDerived: ${
        asset.assetsId != null ? "true" : "false"
      } | parentAssetId: ${asset.assetsId ?? "null"}`,
  );
  sections.push(`## SELECTED_ASSETS\n${assetLines.join("\n")}`);
  const parentLines = input.parentRows.map(
    (parent) => `- assetsId: ${parent.id} | type: ${parent.briefType} | name: ${parent.name ?? ""} | 描述: ${parent.describe ?? ""}`,
  );
  sections.push(`## PARENT_ASSETS\n${parentLines.length ? parentLines.join("\n") : "（空数组）"}`);
  const referenceLines: string[] = [];
  for (const asset of input.assets) {
    for (const reference of input.referencesByAsset.get(asset.id) ?? []) {
      referenceLines.push(
        `- assetsId: ${asset.id} | referenceId: ${referenceBindingId(reference.id)} | 标签: ${presentedReferenceLabel(reference)} | 人工描述: ${reference.description} | visualRole: ${
          reference.visualRole || "未填写"
        } | requiredTransfers: ${JSON.stringify(reference.requiredTransfers)} | exclusions: ${JSON.stringify(reference.exclusions)}`,
      );
    }
  }
  sections.push(`## ASSET_REFERENCES\n${referenceLines.length ? referenceLines.join("\n") : "（空数组）"}`);
  sections.push(`## OUTPUT_SCHEMA\n${input.outputSchema}`);
  return sections.join("\n\n");
}

function isReusableRecord(
  record: Record<string, unknown> | undefined,
  expectation: { templateHash: string; contextHash: string; referenceHash: string; modelProfileJson: string },
): boolean {
  if (!record) return false;
  return (
    record.skillVersion === ASSET_PROMPTING_SKILL_VERSION &&
    record.templateHash === expectation.templateHash &&
    record.contextHash === expectation.contextHash &&
    record.referenceHash === expectation.referenceHash &&
    record.modelProfile === expectation.modelProfileJson &&
    typeof record.generationPrompt === "string" &&
    record.generationPrompt.length > 0
  );
}

/**
 * 把失败结构化落库（按 projectId 过滤，绝不误碰其他项目的资产），
 * 供现有轮询接口读取；失败本身不覆盖最后一个有效 prompt。
 */
async function markGenerationFailed(
  dependencies: AssetPromptOrchestrationDependencies,
  projectId: number,
  assetsIds: readonly number[],
  failure: AssetPromptFailure,
): Promise<void> {
  if (assetsIds.length === 0) return;
  await dependencies
    .work((db) =>
      db("o_assets")
        .where({ projectId })
        .whereIn("id", [...assetsIds])
        .update({
          promptState: "生成失败",
          promptErrorReason: `${failure.kind}: ${failure.message}`,
        }),
    )
    .catch(() => undefined);
}

/** 旧链路 getTypeConfig 的手册键映射：role/scene/tool → art_{character|scene|prop}，衍生资产加 _derivative。 */
function visualManualKey(briefType: AssetBriefType, isDerived: boolean): string {
  return `art_${briefType}${isDerived ? "_derivative" : ""}`;
}

/** 项目视觉规范：为整批资产涉及的类型加载视觉手册，进入分析输入与 contextHash。 */
async function loadVisualManuals(
  dependencies: AssetPromptOrchestrationDependencies,
  artStyle: string | null | undefined,
  assets: readonly TypedAssetRow[],
): Promise<AssetPromptResult<Map<string, string>>> {
  const manuals = new Map<string, string>();
  const style = artStyle?.trim();
  if (!style) return { ok: true, value: manuals };
  const manualKeys = [...new Set(assets.map((asset) => visualManualKey(asset.briefType, asset.assetsId != null)))].sort();
  for (const manualKey of manualKeys) {
    const content = await dependencies.getVisualManual(style, manualKey);
    if (!content || !content.trim()) {
      return {
        ok: false,
        failure: assetPromptFailure("visualManualMissing", `美术风格 ${style} 的视觉手册 ${manualKey} 未定义`),
      };
    }
    manuals.set(manualKey, content);
  }
  return { ok: true, value: manuals };
}

/** 删除资产时同步清理提示词记录，避免 o_assetPromptRecord 孤儿行（与参考图清理同一事务语义）。 */
export async function removeAssetPromptRecordRows(db: Knex, assetIds: readonly number[]): Promise<void> {
  if (assetIds.length === 0) return;
  await db("o_assetPromptRecord").whereIn("assetsId", [...assetIds]).delete();
}

export function createAssetPromptOrchestration(dependencies: AssetPromptOrchestrationDependencies) {
  async function generateBatchAssetPrompts(
    inputValue: GenerateBatchAssetPromptsInput,
  ): Promise<AssetPromptResult<BatchAssetPromptsResult>> {
    const projectId = Number(inputValue?.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return { ok: false, failure: assetPromptFailure("invalidRequest", "projectId 不合法") };
    }
    const assetsIds = parseAssetsIds(inputValue?.assetsIds);
    if (!assetsIds || assetsIds.length === 0) {
      return { ok: false, failure: assetPromptFailure("invalidRequest", "assetsIds 不合法") };
    }
    const otherTextPrompt = normalizeOtherTextPrompt(inputValue?.otherTextPrompt);

    // 输入校验通过后的任何失败都结构化落库（按 projectId 过滤），
    // 批量接口的后台执行也能通过轮询拿到失败原因，而不是静默停留在旧状态。
    const failBatch = async (failure: AssetPromptFailure): Promise<AssetPromptResult<BatchAssetPromptsResult>> => {
      await markGenerationFailed(dependencies, projectId, assetsIds, failure);
      return { ok: false, failure };
    };

    const contextResult = await loadGenerationContext(dependencies, projectId, assetsIds);
    if (!contextResult.ok) return failBatch(contextResult.failure);
    const context = contextResult.value;

    const analysisTemplate = await dependencies.loadSkillFile(ANALYSIS_TEMPLATE_PATH);
    const outputSchema = await dependencies.loadSkillFile(OUTPUT_SCHEMA_PATH);
    if (!analysisTemplate || !outputSchema) {
      return failBatch(
        assetPromptFailure("skillContractMissing", "batch_asset_analysis.md 或 asset-brief.schema.json 缺失"),
      );
    }

    // 项目视觉规范（类型视觉手册）进入分析输入并纳入 contextHash：
    // 手册内容变化后旧提示词失效；artStyle 已设置而手册缺失时按旧链路语义失败。
    const visualManuals = await loadVisualManuals(dependencies, context.project.artStyle, context.assets);
    if (!visualManuals.ok) return failBatch(visualManuals.failure);

    const templateHash = sha256(analysisTemplate);
    const modelProfileJson = JSON.stringify(DEFAULT_MODEL_PROFILE);
    // 版本哈希按资产计算：与批量选择的资产集合无关，单个/批量复用判定一致
    const contextHashByAsset = new Map<number, string>();
    const referenceHashByAsset = new Map<number, string>();
    for (const asset of context.assets) {
      contextHashByAsset.set(
        asset.id,
        computeAssetContextHash({ context, asset, visualManuals: visualManuals.value, otherTextPrompt }),
      );
      referenceHashByAsset.set(asset.id, computeAssetReferenceHash(asset, context));
    }

    const records = await dependencies.work((db) => db("o_assetPromptRecord").whereIn("assetsId", assetsIds).select());
    const recordByAsset = new Map(records.map((record: Record<string, unknown>) => [record.assetsId as number, record]));

    // 批量复用按整批判定：任一资产过期就整批重新分析，保证 worldBible 与
    // Contrast Matrix 来自同一次模型调用，不混合新旧批次的分析结果。
    const anyStale = assetsIds.some((assetsId) =>
      !isReusableRecord(recordByAsset.get(assetsId), {
        templateHash,
        contextHash: contextHashByAsset.get(assetsId)!,
        referenceHash: referenceHashByAsset.get(assetsId)!,
        modelProfileJson,
      }),
    );
    const reusedEntries: GeneratedAssetPromptEntry[] = [];
    const pendingIds: number[] = [];
    if (anyStale) {
      pendingIds.push(...assetsIds);
    } else {
      for (const assetsId of assetsIds) {
        const record = recordByAsset.get(assetsId)!;
        reusedEntries.push({
          assetsId,
          generationPrompt: record.generationPrompt as string,
          reused: true,
          validationState: (record.validationState as "validated" | "repaired") ?? "validated",
        });
      }
    }
    if (pendingIds.length === 0) {
      return { ok: true, value: { entries: reusedEntries, modelCalls: 0 } };
    }

    const pendingAssets = context.assets.filter((asset) => pendingIds.includes(asset.id));
    const expected: ExpectedAssetInput[] = pendingAssets.map((asset) => ({
      assetsId: asset.id,
      briefType: asset.briefType,
      isDerived: asset.assetsId != null,
      parentAssetId: asset.assetsId ?? null,
      references: context.referencesByAsset.get(asset.id) ?? [],
    }));

    await dependencies.work((db) =>
      db("o_assets").whereIn("id", pendingIds).update({ promptState: "生成中", promptErrorReason: null }),
    );

    const failPending = async (failure: AssetPromptFailure, excludeIds: readonly number[] = []): Promise<void> => {
      const targets = pendingIds.filter((id) => !excludeIds.includes(id));
      await markGenerationFailed(dependencies, projectId, targets, failure);
    };

    const user = renderAnalysisUserInput({
      project: context.project,
      scripts: context.scripts,
      assets: pendingAssets,
      parentRows: context.parentRows,
      referencesByAsset: context.referencesByAsset,
      outputSchema,
      visualManuals: visualManuals.value,
    });

    let rawOutput: unknown;
    try {
      rawOutput = await dependencies.analyze({ system: analysisTemplate, user });
    } catch {
      await failPending(assetPromptFailure("analysisFailed", "批量资产分析调用失败"));
      return { ok: false, failure: assetPromptFailure("analysisFailed", "批量资产分析调用失败") };
    }

    const parsedOutput = parseAnalysisOutput(rawOutput);
    if (!parsedOutput.ok) {
      await failPending(parsedOutput.failure);
      return parsedOutput;
    }
    const validated = validateAssetBriefBatch(parsedOutput.value, expected);
    if (!validated.ok) {
      await failPending(validated.failure);
      return validated;
    }

    const artStylePrefix = await dependencies.getArtStylePrefix(context.project.artStyle);
    const now = dependencies.now();
    const entries: GeneratedAssetPromptEntry[] = [...reusedEntries];
    const completedIds: number[] = [];

    for (const brief of validated.value.batch.assetBriefs) {
      const compile = compileAssetGenerationPrompt({
        brief,
        parentAsset: brief.parentAssetId != null ? context.parentById.get(brief.parentAssetId) ?? null : null,
        artStylePrefix,
        modelProfile: DEFAULT_MODEL_PROFILE,
        additionalRequirements: otherTextPrompt,
      });
      if (!compile.ok) {
        await failPending(compile.failure, completedIds);
        return compile;
      }
      const assetRow = context.assets.find((asset) => asset.id === brief.assetId)!;
      const assetRepairs = validated.value.repairs.filter((repair) => repair.assetsId === brief.assetId);
      const validationState: "validated" | "repaired" = assetRepairs.length > 0 ? "repaired" : "validated";
      const batchContext: Record<string, unknown> = {
        worldBible: validated.value.batch.worldBible,
        contrastMatrix: validated.value.batch.contrastMatrix,
      };

      await dependencies.work((db) =>
        db.transaction(async (tx) => {
          await tx("o_assetPromptRecord").where("assetsId", brief.assetId).delete();
          await tx("o_assetPromptRecord").insert({
            projectId,
            assetsId: brief.assetId,
            scriptId: assetRow.scriptId ?? null,
            skillVersion: ASSET_PROMPTING_SKILL_VERSION,
            language: validated.value.batch.language,
            templateHash,
            contextHash: contextHashByAsset.get(brief.assetId)!,
            referenceHash: referenceHashByAsset.get(brief.assetId)!,
            modelProfile: modelProfileJson,
            assetBrief: JSON.stringify(brief),
            batchContext: JSON.stringify(batchContext),
            generationPrompt: compile.value.generationPrompt,
            validationState,
            repairNotes: JSON.stringify(assetRepairs),
            additionalRequirements: otherTextPrompt,
            createTime: now,
            updateTime: now,
          });
          await tx("o_assets").where("id", brief.assetId).update({
            prompt: compile.value.generationPrompt,
            promptState: "已完成",
            promptErrorReason: null,
          });
        }),
      );

      completedIds.push(brief.assetId);
      entries.push({
        assetsId: brief.assetId,
        generationPrompt: compile.value.generationPrompt,
        reused: false,
        validationState,
      });
    }

    return { ok: true, value: { entries, modelCalls: 1 } };
  }

  return { generateBatchAssetPrompts };
}

/** 图片生成解析结果：单个资产的新鲜提示词、版本与有序参考图（Issue #35）。 */
export interface ResolvedAssetGenerationInput {
  assetsId: number;
  /** o_assets.type 原始值，用于 o_image 记录与产物目录映射。 */
  assetRawType: string;
  /** 规范 Brief 类型（character/scene/prop）。 */
  briefType: AssetBriefType;
  name: string;
  /** 最终提示词：o_assetPromptRecord.generationPrompt。 */
  generationPrompt: string;
  /** 提示词版本：复用判定通过的技能版本与三类来源哈希。 */
  promptRevision: {
    skillVersion: string;
    templateHash: string;
    contextHash: string;
    referenceHash: string;
  };
  /** 当前持久化参考图（orderIndex 升序，0~6 张）。 */
  references: AssetReferenceRecord[];
  /** 参与本次生成的参考图 id（编译器确定性选择，orderIndex 升序）。 */
  selectedReferenceIds: number[];
  /** 衍生资产的父资产锚点（基础资产不携带）。 */
  derived?: DerivedParentAnchor;
}

/**
 * 解析图片生成输入（Issue #35）：单个与批量图片生成共用的唯一领域入口。
 *
 * 从 o_assetPromptRecord 解析最终提示词，并以与 generateBatchAssetPrompts 完全
 * 相同的复用判定验证新鲜度：Script/模板/资产事实/视觉手册/参考契约任一变化
 * 都会让记录失效（stalePromptRecord），绝不静默使用过期提示词。参考图超过
 * 能力上限时在外部调用前拒绝。本函数不调用 Text Model。
 */
export async function resolveAssetGenerationInputs(
  dependencies: AssetPromptOrchestrationDependencies,
  input: { projectId: number; assetsIds: readonly number[] },
): Promise<AssetPromptResult<ResolvedAssetGenerationInput[]>> {
  const projectId = Number(input?.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return { ok: false, failure: assetPromptFailure("invalidRequest", "projectId 不合法") };
  }
  const assetsIds = parseAssetsIds(input?.assetsIds);
  if (!assetsIds || assetsIds.length === 0) {
    return { ok: false, failure: assetPromptFailure("invalidRequest", "assetsIds 不合法") };
  }

  const contextResult = await loadGenerationContext(dependencies, projectId, assetsIds);
  if (!contextResult.ok) return { ok: false, failure: contextResult.failure };
  const context = contextResult.value;

  // 参考图超过能力上限：在外部调用前稳定拒绝（第 7 张一律 referenceLimitExceeded）
  for (const asset of context.assets) {
    if (asset.assetsId != null) continue; // 衍生资产整体拒绝人工参考图，由衍生分支判定
    const references = context.referencesByAsset.get(asset.id) ?? [];
    if (references.length > ASSET_REFERENCE_LIMIT) {
      return {
        ok: false,
        failure: assetPromptFailure(
          "referenceLimitExceeded",
          `资产 ${asset.id} 的参考图数量 ${references.length} 超过上限 ${ASSET_REFERENCE_LIMIT}`,
        ),
      };
    }
  }

  const hasBaseAssets = context.assets.some((asset) => asset.assetsId == null);
  let templateHash = "";
  if (hasBaseAssets) {
    const analysisTemplate = await dependencies.loadSkillFile(ANALYSIS_TEMPLATE_PATH);
    if (!analysisTemplate) {
      return { ok: false, failure: assetPromptFailure("skillContractMissing", "batch_asset_analysis.md 缺失") };
    }
    templateHash = sha256(analysisTemplate);
  }

  const visualManuals = await loadVisualManuals(dependencies, context.project.artStyle, context.assets);
  if (!visualManuals.ok) return { ok: false, failure: visualManuals.failure };

  const modelProfileJson = JSON.stringify(DEFAULT_MODEL_PROFILE);
  const artStylePrefix = await dependencies.getArtStylePrefix(context.project.artStyle);
  const assetById = new Map(context.assets.map((asset) => [asset.id, asset]));

  const records = await dependencies.work((db) => db("o_assetPromptRecord").whereIn("assetsId", assetsIds).select());
  const recordByAsset = new Map(records.map((record: Record<string, unknown>) => [record.assetsId as number, record]));

  const entries: ResolvedAssetGenerationInput[] = [];
  for (const assetsId of assetsIds) {
    const asset = assetById.get(assetsId)!;
    // 衍生资产：Parent Asset Anchor + Derived Change Instruction 确定性编译（Issue #37）
    if (asset.assetsId != null) {
      const derivedEntry = await resolveDerivedAssetGenerationEntry(dependencies, {
        projectId,
        asset: {
          id: asset.id,
          name: asset.name,
          type: asset.type,
          describe: asset.describe,
          assetsId: asset.assetsId,
          briefType: asset.briefType,
        },
        parent: context.parentById.get(asset.assetsId) ?? null,
        references: context.referencesByAsset.get(asset.id) ?? [],
        artStyle: context.project.artStyle,
        manualContent: visualManuals.value.get(visualManualKey(asset.briefType, true)) ?? null,
        artStylePrefix,
      });
      if (!derivedEntry.ok) return { ok: false, failure: derivedEntry.failure };
      entries.push(derivedEntry.value);
      continue;
    }
    const record = recordByAsset.get(assetsId);
    if (!record) {
      return {
        ok: false,
        failure: assetPromptFailure("promptNotGenerated", `资产 ${assetsId} 尚未生成提示词，请先生成提示词`),
      };
    }
    // 记录可能来自不同批次（不同 otherTextPrompt），按记录落库值复算该资产哈希
    const otherTextPrompt = normalizeOtherTextPrompt(record.additionalRequirements);
    const contextHash = computeAssetContextHash({
      context,
      asset,
      visualManuals: visualManuals.value,
      otherTextPrompt,
    });
    const referenceHash = computeAssetReferenceHash(asset, context);
    if (!isReusableRecord(record, { templateHash, contextHash, referenceHash, modelProfileJson })) {
      return {
        ok: false,
        failure: assetPromptFailure(
          "stalePromptRecord",
          `资产 ${assetsId} 的提示词记录已过期（Script/模板/资产事实/视觉手册或参考契约已变化），请重新生成提示词`,
        ),
      };
    }
    let brief: AssetBrief;
    try {
      brief = JSON.parse(record.assetBrief as string);
    } catch {
      return {
        ok: false,
        failure: assetPromptFailure("stalePromptRecord", `资产 ${assetsId} 的提示词记录已损坏，请重新生成提示词`),
      };
    }
    const compile = compileAssetGenerationPrompt({
      brief,
      parentAsset: brief.parentAssetId != null ? context.parentById.get(brief.parentAssetId) ?? null : null,
      artStylePrefix,
      modelProfile: DEFAULT_MODEL_PROFILE,
      additionalRequirements: otherTextPrompt,
    });
    if (!compile.ok) return compile;

    const references = context.referencesByAsset.get(assetsId) ?? [];
    const referencesById = new Map(references.map((reference) => [reference.id, reference]));
    const selectedReferenceIds = compile.value.selectedBindings
      .map((binding) => parseReferenceRowId(binding.referenceId))
      .filter((rowId): rowId is number => rowId !== null && referencesById.has(rowId))
      .sort((a, b) => referencesById.get(a)!.orderIndex - referencesById.get(b)!.orderIndex);

    entries.push({
      assetsId,
      assetRawType: asset.type ?? "",
      briefType: asset.briefType,
      name: asset.name ?? "",
      generationPrompt: record.generationPrompt as string,
      promptRevision: {
        skillVersion: record.skillVersion as string,
        templateHash,
        contextHash,
        referenceHash,
      },
      references,
      selectedReferenceIds,
    });
  }
  return { ok: true, value: entries };
}

/** 生产环境依赖：真实数据库、Vendor 文本模型、#29 技能文件与美术风格前缀。 */
export function createDefaultAssetPromptDependencies(): AssetPromptOrchestrationDependencies {
  return {
    work: (operation) => getDatabaseRuntime().work(operation),
    analyze: async ({ system, user }) => {
      const result = (await getDefaultConfiguredVendor().invokeText({
        target: { kind: "logical", key: "universalAi" },
        input: { system, messages: [{ role: "user", content: user }] },
      })) as unknown as Record<string, unknown> | null;
      return result?._output ?? result?.text ?? null;
    },
    loadSkillFile: async (relativePath) => {
      const filePath = getPath(["skills", "asset-prompting", ...relativePath.split("/")]);
      try {
        return fs.readFileSync(filePath, "utf-8");
      } catch {
        return null;
      }
    },
    getArtStylePrefix: async (artStyle) => {
      if (!artStyle) return null;
      const prefix = getAllArtPrompts(artStyle, "art_skills").prefix;
      return prefix && prefix.trim() ? prefix : null;
    },
    getVisualManual: async (artStyle, manualKey) => {
      const content = getArtPrompt(artStyle, "art_skills", manualKey);
      return content && content.trim() ? content : null;
    },
    now: () => Date.now(),
  };
}
