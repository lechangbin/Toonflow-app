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
  type AssetReferenceMediaStore,
} from "@/assets/assetReferences";
import { deleteMediaFileBestEffort, detectImageMime, extensionForMime } from "@/assets/assetReferenceMedia";

const router = express.Router();

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

    // 只信文件头，不信请求声明的 MIME：任意字节伪装成 .png 会被拒绝
    const matches = base64.match(/^data:image\/[\w.+-]+;base64,(.+)$/);
    const realBase64 = matches ? matches[1] : base64;
    const buffer = Buffer.from(realBase64, "base64");
    const mediaMime = detectImageMime(buffer);
    if (!mediaMime) {
      const envelope = assetReferenceErrorEnvelope({ kind: "invalidMedia", message: "" });
      return res.status(envelope.status).send(envelope.body);
    }

    const store: AssetReferenceMediaStore = {
      async write({ projectId: ownerProjectId }) {
        const savePath = `/${ownerProjectId}/assetReferences/${uuidv4()}.${extensionForMime(mediaMime)}`;
        await u.oss.writeFile(savePath, buffer);
        return { mediaPath: savePath, mediaMime };
      },
      async remove(mediaPath) {
        await deleteMediaFileBestEffort(mediaPath);
      },
    };

    const result = await createAssetReference(
      getDatabaseRuntime().work,
      { projectId, assetsId, description, visualRole, requiredTransfers, exclusions },
      store,
    );
    if (!result.ok) {
      const envelope = assetReferenceErrorEnvelope(result.failure);
      return res.status(envelope.status).send(envelope.body);
    }
    res.status(200).send(success(result.value, "参考图创建成功"));
  },
);
