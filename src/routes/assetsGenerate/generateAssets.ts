import express from "express";
import { z } from "zod";

import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertWorkbenchProjectOwner, WorkbenchOwnerRejectedError,
  type WorkbenchOwnerCheck } from "@/video/workbenchOwner";
import {
  assetImageGenerationErrorEnvelope,
  createDefaultAssetImageGenerationDependencies,
  generateAssetImage,
  type AssetImageGenerationDependencies,
} from "@/assets/assetImageGeneration";

/**
 * 单个资产生成图片（Issue #35 迁移）。
 *
 * 旧请求体中的临时参考图字段与前端传入 prompt 不再参与生成：最终提示词、
 * 提示词版本与有序 Asset References 一律由领域模块从 o_assetPromptRecord 与
 * 持久化参考图解析，经 configured Image Vendor 接口提交。旧请求体字段
 * （type/name/prompt/临时参考图）仅做兼容透传，校验后被忽略。
 */
export function createGenerateAssetsRouter(
  dependencies: () => AssetImageGenerationDependencies = createDefaultAssetImageGenerationDependencies,
  authorize: WorkbenchOwnerCheck = assertWorkbenchProjectOwner,
) {
  const router = express.Router();

  router.post(
    "/",
    validateFields({
      projectId: z.number(),
      model: z.string(),
      resolution: z.string(),
      id: z.number(),
    }),
    async (req, res, next) => {
      const { projectId, model, resolution, id } = req.body;
      try {
        await authorize(req, projectId);
      } catch (error) {
        if (error instanceof WorkbenchOwnerRejectedError) {
          return res.status(403).send({ message: error.message });
        }
        return next(error);
      }

      const result = await generateAssetImage(dependencies(), {
        projectId,
        assetsId: id,
        model,
        resolution,
      });
      if (!result.ok) {
        const envelope = assetImageGenerationErrorEnvelope(result.failure);
        return res.status(envelope.status).send(envelope.body);
      }
      return res.status(200).send(success({ path: result.value.imageUrl, assetsId: id }));
    },
  );

  return router;
}

export default createGenerateAssetsRouter();
