import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assetReferenceErrorEnvelope, reorderAssetReferences } from "@/assets/assetReferences";

const router = express.Router();

// 重排资产参考图（orderedIds 必须是当前参考图 id 的完整排列）
export default router.post(
  "/",
  validateFields({
    projectId: z.number().int(),
    assetsId: z.number().int(),
    orderedIds: z.array(z.number().int()),
  }),
  async (req, res) => {
    const { projectId, assetsId, orderedIds } = req.body;
    const result = await reorderAssetReferences(getDatabaseRuntime().work, { projectId, assetsId, orderedIds });
    if (!result.ok) {
      const envelope = assetReferenceErrorEnvelope(result.failure);
      return res.status(envelope.status).send(envelope.body);
    }
    res.status(200).send(success({ list: result.value, total: result.value.length }, "参考图排序成功"));
  },
);
