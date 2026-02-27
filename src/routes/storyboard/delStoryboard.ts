import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    console.log("%c Line:15 🍕 id", "background:#f5ce50", id);
    await u.db("t_assets").where("id", id).delete();
    res.status(200).send(success("分镜删除成功"));
  },
);
