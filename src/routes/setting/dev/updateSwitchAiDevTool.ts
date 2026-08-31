import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    switchAiDevTool: z.string(),
  }),
  async (req, res) => {
    const { switchAiDevTool } = req.body;
    await getDatabaseRuntime().work((db) => db("o_setting").where("key", "switchAiDevTool").update({ value: switchAiDevTool }));
    res.status(200).send(success("保存设置成功"));
  },
);
