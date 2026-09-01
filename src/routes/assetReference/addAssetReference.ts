import express from "express";
import u from "@/utils";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  assetReferenceErrorEnvelope,
  createAssetReference,
  type AssetReferenceMediaWriter,
} from "@/assets/assetReferences";

const router = express.Router();

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

// 新增资产参考图（人工上传 + 人工描述必填）
export default router.post(
  "/",
  validateFields({
    projectId: z.number().int(),
    assetsId: z.number().int(),
    base64: z.string().min(1),
    description: z.string(),
    visualRole: z.string().optional(),
    requiredTransfers: z.array(z.string()).optional(),
    exclusions: z.array(z.string()).optional(),
  }),
  async (req, res) => {
    const { projectId, assetsId, base64, description, visualRole, requiredTransfers, exclusions } = req.body;

    const writeMedia: AssetReferenceMediaWriter = async ({ projectId: ownerProjectId }) => {
      const matches = base64.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
      const mediaMime = matches?.[1] ?? "image/png";
      const realBase64 = matches ? matches[2] : base64;
      const savePath = `/${ownerProjectId}/assetReferences/${uuidv4()}.${MIME_EXTENSIONS[mediaMime] ?? "png"}`;
      await u.oss.writeFile(savePath, Buffer.from(realBase64, "base64"));
      return { mediaPath: savePath, mediaMime };
    };

    const result = await createAssetReference(
      getDatabaseRuntime().work,
      { projectId, assetsId, description, visualRole, requiredTransfers, exclusions },
      writeMedia,
    );
    if (!result.ok) {
      const envelope = assetReferenceErrorEnvelope(result.failure);
      return res.status(envelope.status).send(envelope.body);
    }
    res.status(200).send(success(result.value, "参考图创建成功"));
  },
);
