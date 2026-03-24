import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
import { flowDataSchema } from "@/agents/productionAgent/tools";

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    data: flowDataSchema,
  }),
  async (req, res) => {
    const { projectId, episodesId } = req.body;
    const sqlData = await u.db("o_agentWorkData").where("projectId", String(projectId)).andWhere("episodesId", String(episodesId)).first();
    if (!sqlData) {
      await u.db("o_agentWorkData").insert({
        projectId,
        episodesId,
        data: JSON.stringify(req.body.data),
      });
    } else {
      await u
        .db("o_agentWorkData")
        .where("projectId", String(projectId))
        .andWhere("episodesId", String(episodesId))
        .update({
          data: JSON.stringify(req.body.data),
        });
    }
    return res.status(200).send(success());
  },
);
