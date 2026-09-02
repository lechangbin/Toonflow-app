import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { removeAssetReferenceRows } from "@/assets/assetReferences";
import { removeAssetPromptRecordRows } from "@/assets/assetPromptOrchestration";
import { removeDerivedChangeInstructionRows } from "@/assets/derivedChangeInstruction";
import { deleteMediaFileBestEffort } from "@/assets/assetReferenceMedia";
const router = express.Router();

// 批量删除资产
export default router.post(
  "/",
  validateFields({
    id: z.array(z.number()),
  }),
  async (req, res) => {
    const { id } = req.body;
    // 单一事务：参考图行与资产行要么一起删除，要么都不删除
    const referenceMediaPaths = await getDatabaseRuntime().work(async (db) =>
      db.transaction(async (tx) => {
        const paths = await removeAssetReferenceRows(tx, id);
        await removeAssetPromptRecordRows(tx, id);
        await removeDerivedChangeInstructionRows(tx, id);
        await tx("o_assets").whereIn("id", id).delete();
        return paths;
      }),
    );
    // 记录已删除：参考图媒体清理尽力而为，失败只留下孤儿文件
    await Promise.all(referenceMediaPaths.map((mediaPath) => deleteMediaFileBestEffort(mediaPath)));
    res.status(200).send(success({ message: "删除资产成功" }));
  },
);
