import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    scriptId: z.number(),
    specifyIds: z.array(z.number()),
  }),
  async (req, res) => {
    const { scriptId, specifyIds } = req.body;
    const data = await u.db("o_video").where("scriptId", scriptId).whereIn("id", specifyIds).andWhere("state", "生成中").select("*");
    res.status(200).send(success(data));
  },
);