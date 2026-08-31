import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 获取单个项目
export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;

    const data = await getDatabaseRuntime().work(async (db) => {
      return await db("o_project").where("id", id).select("*");
    });

    res.status(200).send(success(data));
  }
);
