import type { DatabaseWork } from "@/database";

import { removeAssetPromptRecordRows } from "./assetPromptOrchestration";
import { removeDerivedChangeInstructionRows } from "./derivedChangeInstruction";

export type DeleteDerivedAssetResult =
  | { ok: true; value: { id: number; parentAssetId: number } }
  | { ok: false; message: string };

/**
 * 删除单个 Derived Asset 的领域边界（Agent 工具与路由入口）。目标必须属于当前
 * Project，必须确实有父 Asset；Agent 调用还可锁定预期父 Asset，防止伪造 ID 跨
 * 父级删除。
 *
 * Issue #44 的替换式重新提取在 assetExtractionReplacement 的事务内对孤儿资产
 * 及其 Derived children 执行自己的级联清理（含分镜失效与视频过期），不经过本
 * 函数；两者共享 removeAssetPromptRecordRows / removeDerivedChangeInstructionRows
 * 等行删除原语。
 */
export async function deleteDerivedAssetRecord(
  work: DatabaseWork,
  input: { projectId: number; id: number; expectedParentAssetId?: number },
): Promise<DeleteDerivedAssetResult> {
  return work((db) =>
    db.transaction(async (tx) => {
      const asset = await tx("o_assets")
        .where({ id: input.id, projectId: input.projectId })
        .select("id", "assetsId", "flowId")
        .first();
      if (!asset || asset.assetsId == null) return { ok: false as const, message: "衍生资产不存在或不属于当前项目" };
      if (input.expectedParentAssetId !== undefined && asset.assetsId !== input.expectedParentAssetId) {
        return { ok: false as const, message: "衍生资产父资产不匹配" };
      }

      await removeDerivedChangeInstructionRows(tx, [input.id]);
      await removeAssetPromptRecordRows(tx, [input.id]);
      await tx("o_scriptAssets").where("assetId", input.id).delete();
      await tx("o_assets2Storyboard").where("assetId", input.id).delete();
      if (asset.flowId) await tx("o_imageFlow").where("id", asset.flowId).delete();
      await tx("o_assets").where({ id: input.id, projectId: input.projectId, assetsId: asset.assetsId }).delete();
      return { ok: true as const, value: { id: input.id, parentAssetId: Number(asset.assetsId) } };
    }),
  );
}
