import express from "express";
import u from "@/utils";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assetReferenceErrorEnvelope, deleteAssetReference } from "@/assets/assetReferences";

const router = express.Router();

// 删除单张资产参考图（含媒体文件清理）
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
    if (result.value.mediaPath) {
      await u.oss.deleteFile(result.value.mediaPath).catch((e) => {
        if (e?.code !== "ENOENT") throw e;
      });
    }
    res.status(200).send(success({ message: "参考图删除成功" }));
  },
);
