import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assetReferenceErrorEnvelope, deleteAssetReference } from "@/assets/assetReferences";
import { deleteMediaFileBestEffort } from "@/assets/assetReferenceMedia";

const router = express.Router();

// 删除单张资产参考图（数据库记录删除成功后尽力清理媒体文件）
export default router.post(
  "/",
  validateFields({
    projectId: z.number().int(),
    assetsId: z.number().int(),
    id: z.number().int(),
  }),
  async (req, res) => {
    const { projectId, assetsId, id } = req.body;
    const result = await deleteAssetReference(getDatabaseRuntime().work, { projectId, assetsId, id });
    if (!result.ok) {
      const envelope = assetReferenceErrorEnvelope(result.failure);
      return res.status(envelope.status).send(envelope.body);
    }
    // 记录已删除：媒体清理是尽力而为的，失败只留下孤儿文件，
    // 不让 API 对已成功的删除报告失败
    if (result.value.mediaPath) {
      await deleteMediaFileBestEffort(result.value.mediaPath);
    }
    res.status(200).send(success({ message: "参考图删除成功" }));
  },
);
