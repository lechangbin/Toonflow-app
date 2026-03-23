import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    agentType: z.enum(["scriptAgent"]),
  }),
  async (req, res) => {
    const { projectId, agentType } = req.body;
    const data = await u.db("o_agentWorkData").where({ id: projectId, key: agentType }).first();

    if (!data) {
      await u.db("o_agentWorkData").insert({
        id: projectId,
        key: agentType,
        data: JSON.stringify({
          storySkeleton: "",
          adaptationStrategy: "",
        }),
      });
      return res.status(200).send(
        success({
          storySkeleton: "",
          adaptationStrategy: "",
        }),
      );
    }
    res.status(200).send(success(JSON.parse(data.data ?? "{}")));
  },
);
