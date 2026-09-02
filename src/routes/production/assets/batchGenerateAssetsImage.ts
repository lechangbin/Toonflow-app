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
 * Production Agent 批量资产生成图片（Issue #37 迁移）。
 *
 * 模型与分辨率沿用项目设置（旧链路语义）；所有权校验、o_image 占位、
 * Parent Asset Anchor 解析、Derived Change Instruction 确定性提示词编译、
 * Vendor 提交与脱敏任务快照全部在领域模块（assetImageGeneration）内完成。
 * 路由不再调用 Text Model 二次改写提示词，也不再手工加载父图 Base64。
 */
export function createBatchGenerateAssetsImageRouter(
  dependencies: () => AssetImageGenerationDependencies = createDefaultAssetImageGenerationDependencies,
) {
  const router = express.Router();

  router.post(
    "/",
    validateFields({
      assetIds: z.array(z.number()),
      projectId: z.number(),
      scriptId: z.number(),
      concurrentCount: z.number().min(1).optional(),
    }),
    async (req, res) => {
      const { assetIds, projectId, concurrentCount = 5 } = req.body;

      const project = await dependencies().work((db) =>
        db("o_project").where("id", projectId).select("imageModel", "imageQuality").first(),
      );
      if (!project) {
        const envelope = assetImageGenerationErrorEnvelope({ kind: "projectNotFound", message: "项目不存在" });
        return res.status(envelope.status).send(envelope.body);
      }
      if (!project.imageModel || !project.imageQuality) {
        const envelope = assetImageGenerationErrorEnvelope({
          kind: "invalidRequest",
          message: "项目图片模型或分辨率未配置",
        });
        return res.status(envelope.status).send(envelope.body);
      }

      const prepared = await prepareBatchAssetImages(dependencies(), {
        projectId,
        assetsIds: assetIds,
        model: project.imageModel,
        resolution: project.imageQuality,
      });
      if (!prepared.ok) {
        const envelope = assetImageGenerationErrorEnvelope(prepared.failure);
        return res.status(envelope.status).send(envelope.body);
      }

      const limit = pLimit(concurrentCount);
      const tasks = prepared.value.map((record) =>
        limit(() =>
          generateAssetImage(dependencies(), {
            projectId,
            assetsId: record.assetsId,
            model: project.imageModel,
            resolution: project.imageQuality,
            imageId: record.imageId,
          }),
        ),
      );
      // 后台执行，不阻塞响应；失败已由领域模块回写 o_image 占位记录供轮询诊断
      Promise.all(tasks).catch((error) => {
        console.error("[batchGenerateAssetsImage] 后台生成编排失败:", error);
      });

      return res.status(200).send(success("开始生成资产图片"));
    },
  );

  return router;
}

export default createBatchGenerateAssetsImageRouter();
