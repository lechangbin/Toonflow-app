import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    name: z.string(),
    password: z.string(),
    id: z.number(),
  }),
  async (req, res) => {
    const { name, password, id } = req.body;
    await getDatabaseRuntime().work(async (db) => {
      await db("o_user").where("id", id).update({
        name,
        password,
      });
    });
    res.status(200).send(success("保存设置成功"));
  },
);
