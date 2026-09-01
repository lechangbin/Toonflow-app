import express from "express";
import * as zod from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  assetPromptErrorEnvelope,
  createAssetPromptOrchestration,
  createDefaultAssetPromptDependencies,
  normalizeBatchPromptRequest,
} from "@/assets/assetPromptOrchestration";

const router = express.Router();

/**
 * 批量资产提示词生成（Issue #33 重构）。
 *
 * 路由保持薄适配器：请求体兼容旧字段（items[].assetsId/type/name/describe、
 * projectId、concurrentCount、otherTextPrompt），其中 otherTextPrompt 不再必填，
 * type/name/describe 仅供参考，数据库中的资产事实是唯一输入来源。
 * 整批资产由共享 orchestration 模块用一次 Text Model 调用处理；结构化错误
 * 通过 promptState/promptErrorReason 持久化，由现有轮询接口读取。
 */
export default router.post(
  "/",
  validateFields({
    items: zod.array(
      zod.object({
        assetsId: zod.number(),
        type: zod.string(),
        name: zod.string(),
        describe: zod.string(),
      }),
    ),
    projectId: zod.number(),
    concurrentCount: zod.number().int().min(1).optional(),
    // 修复 Issue #33：otherTextPrompt 原被错误设为必填，现改为可选补充要求
    otherTextPrompt: zod.string().optional().nullable(),
  }),
  async (req, res) => {
    const normalized = normalizeBatchPromptRequest(req.body);
    if (!normalized.ok) {
      const envelope = assetPromptErrorEnvelope(normalized.failure);
      return res.status(envelope.status).send(envelope.body);
    }

    const orchestration = createAssetPromptOrchestration(createDefaultAssetPromptDependencies());
    // 后台执行整批生成（至多一次模型调用），不阻塞响应；失败被结构化落库，不会泄露模型异常
    orchestration.generateBatchAssetPrompts(normalized.value).catch(() => undefined);

    return res.status(200).send(success({ total: normalized.value.assetsIds.length }));
  },
);
