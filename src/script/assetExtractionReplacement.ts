import { randomUUID } from "node:crypto";
import type { Knex } from "knex";

import type { DatabaseWork } from "@/database";
import { deleteMediaFileIfPresent } from "@/assets/assetReferenceMedia";
import { removeAssetReferenceRows } from "@/assets/assetReferences";
import { removeAssetPromptRecordRows } from "@/assets/assetPromptOrchestration";
import { removeDerivedChangeInstructionRows } from "@/assets/derivedChangeInstruction";
import {
  BaseAssetExtractionFailure,
  claimScriptAssetExtraction,
  createDefaultBaseAssetExtractionDependencies,
  persistStagedBaseAssets,
  runBaseAssetExtractionWithScripts,
  type BaseAssetExtractionDependencies,
  type BaseAssetExtractionFailureKind,
  type BaseAssetExtractionInput,
  type ScriptAssetExtractionClaimInput,
  type ScriptRecord,
  type StagedBaseAssetExtraction,
} from "./baseAssetExtraction";

export { claimScriptAssetExtraction } from "./baseAssetExtraction";

/**
 * Asset Extraction Replacement 领域模块（Issue #44）。
 *
 * 一个深层模块接口，负责“确认后的原子资产提取替换”的完整数据库语义：
 *
 *   1. `claimScriptAssetExtraction`（复用 baseAssetExtraction）：后端权威的确
 *      认门禁 + 并发安全的剧本占用。缺少替换意图而已有关联资产时稳定拒绝
 *      （reextractConfirmationRequired），不执行模型调用、不改变数据库状态。
 *   2. `runClaimedScriptAssetExtraction`：两次 Text Model 调用、全部解析、证
 *      据校验、审计与确定性归并完成并得到完整 staged result 之后，才进入替换。
 *   3. `replaceScriptAssetExtraction`：同一个数据库事务内替换所选 Script 的
 *      o_scriptAssets 关联、持久化 staged 结果、复用证据支持的既有身份、保留
 *      仍被未选 Script 使用的共享资产、删除真正成为孤儿的资产（无论来源）及
 *      其全部 Derived children 与下游关系，并让受影响的分镜图片与视频结果失效。
 *
 * 任何模型、校验或事务失败都保留全部旧数据。实体媒体文件只在事务成功提交后
 * 尽力删除；删除失败只记录结构化日志，不回滚数据库。HTTP 路由保持薄适配器。
 */

export interface ScriptAssetExtractionDependencies extends BaseAssetExtractionDependencies {
  /** 删除一个实体媒体文件；ENOENT 视为成功，其余错误由本模块捕获并记录。 */
  deleteMediaFile(mediaPath: string): Promise<void>;
}

export interface AssetExtractionReplacementResult {
  /** 证据支持而被复用的既有资产。 */
  reusedAssetIds: number[];
  /** 本次新建的资产。 */
  createdAssetIds: number[];
  /** 被删除的孤儿资产，含全部 Derived children。 */
  deletedAssetIds: number[];
  /** 因资产删除而失去关联、图片被标记过期的分镜。 */
  affectedStoryboardIds: number[];
  /** 因分镜图片过期而整体失效的视频轨道。 */
  staleVideoTrackIds: number[];
}

export interface BaseAssetExtractionOutcome {
  ok: boolean;
  error?: BaseAssetExtractionFailureKind;
  assetCount?: number;
}

/** 路由可见的稳定失败 kind（与 claim 状态一一对应）。 */
export type ScriptAssetExtractionRouteFailure =
  | "reextractConfirmationRequired"
  | "extractionInProgress"
  | "scriptNotFound";

/** 稳定错误契约表：kind → HTTP 状态与用户可见文案，路由只转发信封。 */
export const SCRIPT_ASSET_EXTRACTION_FAILURES: Record<
  ScriptAssetExtractionRouteFailure,
  { status: number; message: string }
> = {
  reextractConfirmationRequired: { status: 409, message: "当前操作会删除当前已有资产，请确认是否提取" },
  extractionInProgress: { status: 409, message: "已有提取任务正在运行" },
  scriptNotFound: { status: 400, message: "未找到属于当前项目的可提取剧本" },
};

/** 与 assetReferenceErrorEnvelope 同形的稳定错误信封。 */
export function scriptAssetExtractionErrorEnvelope(kind: ScriptAssetExtractionRouteFailure): {
  status: number;
  body: { code: number; data: null; message: string; error: ScriptAssetExtractionRouteFailure };
} {
  const { status, message } = SCRIPT_ASSET_EXTRACTION_FAILURES[kind];
  return { status, body: { code: status, data: null, message, error: kind } };
}

// ---------------------------------------------------------------------------
// 单事务替换：领域模块的核心接口
// ---------------------------------------------------------------------------

export async function replaceScriptAssetExtraction(
  dependencies: ScriptAssetExtractionDependencies,
  staged: StagedBaseAssetExtraction,
): Promise<AssetExtractionReplacementResult> {
  const mediaPaths: string[] = [];
  let result: AssetExtractionReplacementResult;
  try {
    result = await dependencies.work((db) =>
      db.transaction(async (trx) => {
        // 1. 快照替换前所选剧本的全部资产关联。
        const previousLinks = await trx("o_scriptAssets").whereIn("scriptId", staged.scriptIds).select("assetId");
        const previousAssetIds = [...new Set(previousLinks.map((link) => link.assetId))];

        // 2. 持久化 staged 结果：复用证据支持的既有身份、新建资产、替换关联。
        const persisted = await persistStagedBaseAssets(trx, dependencies, staged);

        // 3. 计算真正的孤儿：替换后不再被任何剧本关联、且未被结果复用。
        const reused = new Set(persisted.reusedAssetIds);
        let stillLinked = new Set<number>();
        if (previousAssetIds.length) {
          const remaining = await trx("o_scriptAssets").whereIn("assetId", previousAssetIds).select("assetId");
          stillLinked = new Set(remaining.map((link) => link.assetId));
        }
        const baseOrphans = previousAssetIds.filter((id) => !reused.has(id) && !stillLinked.has(id));

        // 4. 孤儿的全部 Derived children 一并删除（无论创建来源）。
        const deletedAssetIds = await expandDerivedChildren(trx, baseOrphans);

        // 5. 级联删除与失效。
        const { affectedStoryboardIds, staleVideoTrackIds } = await cascadeDeleteOrphanedAssets(
          trx,
          dependencies,
          deletedAssetIds,
          mediaPaths,
        );

        return {
          reusedAssetIds: persisted.reusedAssetIds,
          createdAssetIds: persisted.createdAssetIds,
          deletedAssetIds,
          affectedStoryboardIds,
          staleVideoTrackIds,
        };
      }),
    );
  } catch (error) {
    throw new BaseAssetExtractionFailure(
      "persistenceFailed",
      `Base Asset 替换事务失败: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 6. 事务提交后才清理实体媒体文件；尽力而为，失败只记录结构化日志。
  for (const mediaPath of mediaPaths) {
    try {
      await dependencies.deleteMediaFile(mediaPath);
    } catch (error) {
      dependencies.log({
        stage: "mediaCleanup",
        kind: "mediaCleanupFailed",
        mediaPath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

/** 递归收集孤儿 Base Asset 的全部 Derived children。 */
async function expandDerivedChildren(trx: Knex, baseOrphans: number[]): Promise<number[]> {
  const all = new Set<number>(baseOrphans);
  let frontier = baseOrphans;
  while (frontier.length) {
    const children = await trx("o_assets").whereIn("assetsId", frontier).select("id");
    frontier = children.map((child) => child.id).filter((id) => !all.has(id));
    frontier.forEach((id) => all.add(id));
  }
  return [...all];
}

/**
 * 单事务内的孤儿级联删除与下游失效：
 *   - 删除 Script 关联、Storyboard 关联、Asset References、图片及媒体数据库
 *     记录、Asset Prompt Records、Image Flow Records、Derived Change
 *     Instructions、身份记录与资产行本身；
 *   - 分镜文本/镜头结构保留，但失去关联的分镜图片被清除并标记未生成；
 *   - 受影响轨道的视频结果与 Artifact Revision 标记过期/拒绝，禁止静默复用。
 */
async function cascadeDeleteOrphanedAssets(
  trx: Knex,
  dependencies: ScriptAssetExtractionDependencies,
  deletedAssetIds: number[],
  mediaPaths: string[],
): Promise<{ affectedStoryboardIds: number[]; staleVideoTrackIds: number[] }> {
  if (!deletedAssetIds.length) return { affectedStoryboardIds: [], staleVideoTrackIds: [] };

  // 资产参考图：行删除 + 媒体路径收集。
  mediaPaths.push(...(await removeAssetReferenceRows(trx, deletedAssetIds)));
  await removeAssetPromptRecordRows(trx, deletedAssetIds);
  await removeDerivedChangeInstructionRows(trx, deletedAssetIds);

  // 资产生成图片：行删除 + 媒体路径收集；其他资产的 imageId 引用先置空。
  const imageRows = await trx("o_image").whereIn("assetsId", deletedAssetIds).select("id", "filePath");
  mediaPaths.push(...imageRows.map((row) => row.filePath).filter((filePath): filePath is string => Boolean(filePath)));
  const imageIds = imageRows.map((row) => row.id);
  if (imageIds.length) {
    await trx("o_assets").whereIn("imageId", imageIds).update({ imageId: null });
    await trx("o_image").whereIn("id", imageIds).delete();
  }

  // 图片工作流：只删除仍被孤儿资产独占的记录。
  const flowRows = await trx("o_assets").whereIn("id", deletedAssetIds).whereNotNull("flowId").select("flowId");
  const orphanFlowIds = [...new Set(flowRows.map((row) => row.flowId as number))];
  if (orphanFlowIds.length) {
    const survivingFlowRows = await trx("o_assets")
      .whereNotNull("flowId")
      .whereNotIn("id", deletedAssetIds)
      .select("flowId");
    const survivingFlowIds = new Set(survivingFlowRows.map((row) => row.flowId as number));
    const removableFlowIds = orphanFlowIds.filter((flowId) => !survivingFlowIds.has(flowId));
    if (removableFlowIds.length) await trx("o_imageFlow").whereIn("id", removableFlowIds).delete();
  }

  // Storyboard 关联：删除指向已删除资产的行，记录受影响分镜。
  const storyboardLinkRows = await trx("o_assets2Storyboard")
    .whereIn("assetId", deletedAssetIds)
    .select("storyboardId");
  const affectedStoryboardIds = [...new Set(storyboardLinkRows.map((row) => row.storyboardId))];
  await trx("o_assets2Storyboard").whereIn("assetId", deletedAssetIds).delete();

  // 脚本关联、身份记录与资产行本身。
  await trx("o_scriptAssets").whereIn("assetId", deletedAssetIds).delete();
  await trx("o_assetIdentity").whereIn("assetsId", deletedAssetIds).delete();
  await trx("o_assets").whereIn("id", deletedAssetIds).delete();

  // 分镜图片失效：文本、镜头结构、顺序保留；可复用图片结果清除。
  let staleVideoTrackIds: number[] = [];
  if (affectedStoryboardIds.length) {
    await trx("o_storyboard").whereIn("id", affectedStoryboardIds).update({
      filePath: "",
      state: "未生成",
    });
    const storyboardRows = await trx("o_storyboard")
      .whereIn("id", affectedStoryboardIds)
      .whereNotNull("trackId")
      .select("trackId");
    staleVideoTrackIds = [...new Set(storyboardRows.map((row) => row.trackId as number))];
  }

  // 视频失效：轨道不再选中旧视频，旧视频与 Artifact Revision 标记过期/拒绝，
  // 后续生成无法静默复用旧图片或旧视频。
  if (staleVideoTrackIds.length) {
    const videoRows = await trx("o_video").whereIn("videoTrackId", staleVideoTrackIds).select("artifactRevisionId");
    await trx("o_video").whereIn("videoTrackId", staleVideoTrackIds).update({ state: "已过期" });
    await trx("o_videoTrack").whereIn("id", staleVideoTrackIds).update({
      state: "已过期",
      reason: "资产已替换，分镜图片需重新生成",
      videoId: null,
    });
    const revisionIds = videoRows
      .map((row) => row.artifactRevisionId)
      .filter((revisionId): revisionId is number => Boolean(revisionId));
    if (revisionIds.length) {
      await trx("o_artifactRevision").whereIn("id", revisionIds).update({ status: "rejected" });
    }
  }

  dependencies.log({
    stage: "replacement",
    kind: "orphanCascade",
    deletedAssetIds,
    affectedStoryboardIds,
    staleVideoTrackIds,
  });
  return { affectedStoryboardIds, staleVideoTrackIds };
}

// ---------------------------------------------------------------------------
// 编排入口：确认占用 → 生成 → 替换 → 回写状态
// ---------------------------------------------------------------------------

/** 路由/调用方的后台执行入口：剧本已占用，直接生成并原子替换。 */
export async function runClaimedScriptAssetExtraction(
  dependencies: ScriptAssetExtractionDependencies,
  scripts: ScriptRecord[],
): Promise<BaseAssetExtractionOutcome> {
  const requestId = randomUUID();
  const resolvedIds = scripts.map((script) => script.id);
  try {
    const staged = await runBaseAssetExtractionWithScripts(dependencies, scripts);
    const result = await replaceScriptAssetExtraction(dependencies, staged);
    await dependencies.work((db) =>
      db("o_script").whereIn("id", resolvedIds).update({ extractState: 1, errorReason: null }),
    );
    dependencies.log({
      requestId,
      stage: "persist",
      scriptIds: resolvedIds,
      count: staged.candidates.length,
      reused: result.reusedAssetIds.length,
      created: result.createdAssetIds.length,
      deleted: result.deletedAssetIds.length,
    });
    return { ok: true, assetCount: staged.candidates.length };
  } catch (error) {
    const failure = asFailure(error);
    dependencies.log({
      requestId,
      stage: "failed",
      kind: failure.kind,
      scriptIds: resolvedIds,
      message: failure.message,
    });
    if (resolvedIds.length) {
      try {
        await dependencies.work((db) =>
          db("o_script").whereIn("id", resolvedIds).update({ extractState: -1, errorReason: failure.message }),
        );
      } catch (stateError) {
        dependencies.log({
          requestId,
          stage: "failed",
          kind: "stateWriteFailed",
          message: stateError instanceof Error ? stateError.message : String(stateError),
        });
      }
    }
    return { ok: false, error: failure.kind };
  }
}

/** 一步式入口：确认占用（含 409 门禁）后执行。测试与后台任务共用同一编排。 */
export async function executeScriptAssetExtraction(
  dependencies: ScriptAssetExtractionDependencies,
  input: BaseAssetExtractionInput & Pick<ScriptAssetExtractionClaimInput, "replaceExisting">,
): Promise<BaseAssetExtractionOutcome> {
  const claim = await claimScriptAssetExtraction(dependencies, input);
  if (claim.status !== "claimed") {
    if (claim.status !== "scriptNotFound") {
      dependencies.log({ stage: "resolve", kind: claim.status, scriptIds: [...input.scriptIds] });
    }
    return { ok: false, error: claim.status };
  }
  return runClaimedScriptAssetExtraction(dependencies, claim.scripts);
}

function asFailure(error: unknown): BaseAssetExtractionFailure {
  if (error instanceof BaseAssetExtractionFailure) return error;
  return new BaseAssetExtractionFailure("modelCallFailed", error instanceof Error ? error.message : String(error));
}

// ---------------------------------------------------------------------------
// 生产环境依赖
// ---------------------------------------------------------------------------

export function createDefaultScriptAssetExtractionDependencies(): ScriptAssetExtractionDependencies {
  return {
    ...createDefaultBaseAssetExtractionDependencies(),
    deleteMediaFile: (mediaPath) => deleteMediaFileIfPresent(mediaPath),
  };
}
