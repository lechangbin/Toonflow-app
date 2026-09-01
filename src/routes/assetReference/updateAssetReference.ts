import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assetReferenceErrorEnvelope, updateAssetReference } from "@/assets/assetReferences";

const router = express.Router();

// 更新参考图的人工契约（描述一旦提供必须非空）
export default router.post(
  "/",
  validateFields({
    projectId: z.number().int(),
    assetsId: z.number().int(),
    id: z.number().int(),
    description: z.string().optional(),
    visualRole: z.string().optional(),
    requiredTransfers: z.array(z.string()).optional(),
    exclusions: z.array(z.string()).optional(),
  }),
  async (req, res) => {
    const { projectId, assetsId, id, description, visualRole, requiredTransfers, exclusions } = req.body;
    const result = await updateAssetReference(getDatabaseRuntime().work, {
      projectId,
      assetsId,
      id,
      description,
      visualRole,
      requiredTransfers,
      exclusions,
    });
    if (!result.ok) {
      const envelope = assetReferenceErrorEnvelope(result.failure);
      return res.status(envelope.status).send(envelope.body);
    }
    res.status(200).send(success(result.value, "参考图更新成功"));
  },
);
