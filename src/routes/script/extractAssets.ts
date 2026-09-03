import express from "express";
import { z } from "zod";

import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  createDefaultBaseAssetExtractionDependencies,
  executeScriptAssetExtraction,
} from "@/script/baseAssetExtraction";

/**
 * Script Base Asset 提取的薄适配器（Issue #41）。
 *
 * 校验、双阶段 Text Model 编排、确定性归并与一次性写入全部在
 * src/script/baseAssetExtraction.ts；本路由只转发请求。全量选中剧本作为
 * 一个完整上下文处理，不存在分组或分片。
 */
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    scriptIds: z.array(z.number()),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { scriptIds, projectId } = req.body;
    if (!scriptIds.length) return res.status(400).send(error("请先选择剧本"));

    // 提取在后台完成；进度通过 o_script.extractState 轮询（pollScriptAssets）。
    void executeScriptAssetExtraction(createDefaultBaseAssetExtractionDependencies(), {
      projectId,
      scriptIds,
    });
    res.send(success("开始提取资产"));
  },
);
