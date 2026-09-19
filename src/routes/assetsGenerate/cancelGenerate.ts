import express from "express";
import { getDatabaseRuntime, type DatabaseWork } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { cancelImageGeneration } from "@/assets/imageGenerationLifecycle";

/**
 * 取消图片生成（Issue #39）。
 *
 * 只在非终态（等待中/生成中/下载中）上生效：置为“已取消”终态。
 * 已完成/已失败/已取消的记录不被改写；供应商迟到结果也不会覆盖“已取消”
 * （领域模块的终态写入都带同样的非终态条件）。
 */
export function createCancelGenerateRouter(resolveWork: () => DatabaseWork = () => getDatabaseRuntime().work) {
  const router = express.Router();
  router.post(
    "/",
    validateFields({
      id: z.number(),
    }),
    async (req, res) => {
      const { id } = req.body;
      await resolveWork()((db) => cancelImageGeneration(db, id));
      res.status(200).send(success({ message: "取消成功" }));
    },
  );
  return router;
}

export default createCancelGenerateRouter();
