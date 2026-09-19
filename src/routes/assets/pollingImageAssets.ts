import express from "express";
import u from "@/utils";

import { getDatabaseRuntime, type DatabaseWork } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { readImageGenerationPollingRows } from "@/assets/imageGenerationLifecycle";

/**
 * 图片生成权威状态轮询（Issue #39）。
 *
 * 对每个请求的资产 id 都返回一条结果：等待中/生成中/下载中/已完成/
 * 生成失败/已取消，资产或图片记录缺失时返回 state=null。绝不因为 SQL
 * 过滤或省略行导致前端永久等待。errorKind 是稳定的失败分类
 * （imageGenerationTimeout / imageDownloadFailed / …），前端据此区分展示。
 */
export function createPollingImageAssetsRouter(
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
            filePath: row.filePath ? await u.oss.getSmallImageUrl(row.filePath) : null,
            errorKind: row.errorKind,
          };
        }),
      );
      res.status(200).send(success(result));
    },
  );
  return router;
}

export default createPollingImageAssetsRouter();
