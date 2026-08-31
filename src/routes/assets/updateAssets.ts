import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { id } from "zod/locales";
const router = express.Router();

// 更新资产
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string(),
    describe: z.string(),
    remark: z.string().optional().nullable(),
    prompt: z.string().optional().nullable(),
  }),
  async (req, res) => {
    const { id, name, describe, remark, prompt } = req.body;
    await getDatabaseRuntime().work(async (db) => {
      await db("o_assets").where({ id }).update({
        name,
        describe,
        remark,
        prompt,
      });
    });
    res.status(200).send(success({ message: "更新资产成功" }));
  },
);
