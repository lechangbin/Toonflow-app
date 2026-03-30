import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    data: z.array(
      z.object({
        prompt: z.string(),
      }),
    ),
    scriptId: z.number(),
  }),
  async (req, res) => {
    const { data, scriptId } = req.body;
    if (!data.length) return res.status(400).send({ success: false, message: "数据不能为空" });
    await u.db("o_storyboard").insert(
      data.map((i: { prompt: string }) => ({
        ...i,
        scriptId,
        createTime: Date.now(),
        state: "未生成",
      })),
    );
    return res.status(200).send(success());
  },
);
