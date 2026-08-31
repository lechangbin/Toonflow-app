import express from "express";
import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    taskId: z.number(),
  }),
  async (req, res) => {
    const { taskId } = req.body;
    const data = await getDatabaseRuntime().work(async (db) => {
      return await db("o_tasks").where("id", taskId).select("*").first();
    });
    res.status(200).send(success(data));
  }
);
