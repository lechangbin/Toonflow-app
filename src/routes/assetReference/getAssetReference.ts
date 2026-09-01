import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assetReferenceErrorEnvelope, listAssetReferences } from "@/assets/assetReferences";

const router = express.Router();

// 获取资产的全部参考图（按持久化顺序，可为空列表）
export default router.post(
  "/",
  validateFields({
    projectId: z.number().int(),
    assetsId: z.number().int(),
  }),
  async (req, res) => {
    const { projectId, assetsId } = req.body;
    const result = await listAssetReferences(getDatabaseRuntime().work, { projectId, assetsId });
    if (!result.ok) {
      const envelope = assetReferenceErrorEnvelope(result.failure);
      return res.status(envelope.status).send(envelope.body);
    }
    res.status(200).send(success({ list: result.value, total: result.value.length }));
  },
);
