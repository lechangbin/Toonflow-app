import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    ids: z.array(z.number()),
  }),
  async (req, res) => {
    const { ids } = req.body;
    const data = await getDatabaseRuntime().work(async (db) => {
      return await db("o_assets").whereIn("id", ids).whereNot("audioBindState", "生成中").select("*");
    });
    res.status(200).send(success(data));
  },
);
