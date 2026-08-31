import express from "express";
import { z } from "zod";
import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { id } from "zod/locales";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    prompt: z.string(),
    videoDesc: z.string(),
  }),
  async (req, res) => {
    const { id, prompt, videoDesc } = req.body;
    await getDatabaseRuntime().work((db) =>
      db("o_storyboard").where({ id }).update({
        prompt,
        videoDesc,
      }),
    );
    res.status(200).send(success({ message: "更新提示词成功" }));
  },
);
