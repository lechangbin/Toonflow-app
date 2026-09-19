import express from "express";
import u from "@/utils";

import { getDatabaseRuntime, type DatabaseWork } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { readImageGenerationPollingRows } from "@/assets/imageGenerationLifecycle";

/**
 * Production Agent 资产图片权威状态轮询（Issue #39）。
 *
 * 与 /api/assets/pollingImageAssets 共用同一生命周期契约：对每个请求的
 * 资产 id 都返回一条结果（等待中/生成中/下载中/终态或 null 缺失），
 * 绝不因 SQL 过滤或省略行导致前端永久等待。
 */
export function createProductionPollingImageRouter(
  resolveWork: () => DatabaseWork = () => getDatabaseRuntime().work,
) {
  const router = express.Router();
  router.post(
    "/",
    validateFields({
      ids: z.array(z.number()),
    }),
    async (req, res) => {
      const { ids } = req.body;
      const rows = await resolveWork()((db) => readImageGenerationPollingRows(db, ids as number[]));
      const result = await Promise.all(
        (ids as number[]).map(async (id) => {
          const row = rows.get(id)!;
          return {
            id,
            state: row.state,
            src: row.filePath ? await u.oss.getSmallImageUrl(row.filePath) : null,
            errorKind: row.errorKind,
            prompt: row.prompt,
          };
        }),
      );
      res.status(200).send(success(result));
    },
  );
  return router;
}

export default createProductionPollingImageRouter();
