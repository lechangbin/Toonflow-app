import express from "express";
import { z } from "zod";
import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { deleteDerivedAssetRecord } from "@/assets/derivedAssetDeletion";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { id, projectId } = req.body;
    const deleted = await deleteDerivedAssetRecord(getDatabaseRuntime().work, { projectId, id });
    if (!deleted.ok) {
      return res.status(404).send({ error: "资源未找到" });
    }
    res.status(200).send(success({ message: "视频删除成功" }));
  },
);
