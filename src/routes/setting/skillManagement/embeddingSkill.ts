import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getEmbedding } from "@/utils/agent/embedding";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.string(),
  }),
  async (req, res) => {
    const { id } = req.body;

    const skill = await u.db("o_skillList").where("id", id).first();

    if (!skill) return res.status(404).send(error("技能不存在"));
    if (skill.embedding) return res.status(400).send(error("技能已存在向量，请勿重复生成"));
    if (!skill.description) return res.status(400).send(error("技能描述不存在"));
    const embedding = await getEmbedding(skill.description);
    await u
      .db("o_skillList")
      .where("id", id)
      .update({ embedding: JSON.stringify(embedding) });

    res.status(200).send(success("技能向量生成成功"));
  },
);
