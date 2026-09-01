import express from "express";
import * as zod from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  assetPromptErrorEnvelope,
  createAssetPromptOrchestration,
  createDefaultAssetPromptDependencies,
} from "@/assets/assetPromptOrchestration";

const router = express.Router();

/**
 * 单资产提示词生成（Issue #33 重构）。
 *
 * 与批量接口共用同一 orchestration 模块：单个资产走同一条"一次模型调用 →
 * Asset Brief 校验 → 编译"流水线，数据库中的资产事实（名称/描述/类型/衍生
 * 关系/参考图）是唯一输入来源。请求体保持旧字段兼容；响应保持 { prompt,
 * assetsId } 结构。修复旧实现：不再把未校验的模型原始输出直接落库。
 */
export default router.post(
  "/",
  validateFields({
    assetsId: zod.number(),
    projectId: zod.number(),
    type: zod.string(),
    name: zod.string(),
    describe: zod.string(),
  }),
  async (req, res) => {
    const { assetsId, projectId } = req.body;

    const orchestration = createAssetPromptOrchestration(createDefaultAssetPromptDependencies());
    const result = await orchestration.generateBatchAssetPrompts({ projectId, assetsIds: [assetsId] });
    if (!result.ok) {
      const envelope = assetPromptErrorEnvelope(result.failure);
      return res.status(envelope.status).send(envelope.body);
    }

    const entry = result.value.entries[0];
    return res.status(200).send(success({ prompt: entry.generationPrompt, assetsId }));
  },
);
