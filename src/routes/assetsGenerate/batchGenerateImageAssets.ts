import express from "express";
import pLimit from "p-limit";
import { z } from "zod";

import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  assetImageGenerationErrorEnvelope,
  createDefaultAssetImageGenerationDependencies,
  generateAssetImage,
  prepareBatchAssetImages,
  type AssetImageGenerationDependencies,
} from "@/assets/assetImageGeneration";

/**
 * 批量资产生成图片（Issue #35 迁移）。
 *
 * 与单个生成共用同一领域入口：所有权校验通过后一次性预置 o_image 占位，
 * 后台按并发上限逐个经 generateAssetImage 解析提示词与持久化参考图并提交。
 * 旧 items[] 中的临时参考图字段不再参与生成；失败回写占位记录供轮询诊断。
 */
export function createBatchGenerateImageAssetsRouter(
  dependencies: () => AssetImageGenerationDependencies = createDefaultAssetImageGenerationDependencies,
) {
  const router = express.Router();

  router.post(
    "/",
    validateFields({
      projectId: z.number(),
      model: z.string(),
      resolution: z.string(),
      concurrentCount: z.number().int().min(1).optional(),
      items: z.array(z.object({ id: z.number() })),
    }),
    async (req, res) => {
      const { projectId, model, resolution, concurrentCount, items } = req.body;

      const prepared = await prepareBatchAssetImages(dependencies(), {
        projectId,
        assetsIds: items.map((item: { id: number }) => item.id),
        model,
        resolution,
      });
      if (!prepared.ok) {
        const envelope = assetImageGenerationErrorEnvelope(prepared.failure);
        return res.status(envelope.status).send(envelope.body);
      }

      const limit = pLimit(concurrentCount ?? 1);
      const tasks = prepared.value.map((record) =>
        limit(() =>
          generateAssetImage(dependencies(), {
            projectId,
            assetsId: record.assetsId,
            model,
            resolution,
            imageId: record.imageId,
          }),
        ),
      );
      // 后台执行，不阻塞响应；失败已由领域模块回写 o_image 占位记录
      Promise.all(tasks).catch(() => {});

      return res.status(200).send(success({ total: items.length }));
    },
  );

  return router;
}

export default createBatchGenerateImageAssetsRouter();
