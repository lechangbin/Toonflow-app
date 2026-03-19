import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number().optional(),
    type: z.enum(["message", "summary", "all"]).optional(),
  }),
  async (req, res) => {
    const { projectId, episodesId, type = "all" } = req.body;
    const isolationKey = `${projectId}:${episodesId ?? ""}`;

    const query = u.db("memories").where({ isolationKey });
    if (type !== "all") query.where("type", type);

    await query.del();

    res.status(200).send(success(null));
  },
);
