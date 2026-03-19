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
  }),
  async (req, res) => {
    const { projectId, episodesId } = req.body;
    const isolationKey = `${projectId}:${episodesId ?? ""}`;

    const rows = await u
      .db("memories")
      .where({ isolationKey, type: "message" })
      .orderBy("createTime", "asc")
      .select("id", "content", "createTime");

    const history = rows.map((row) => ({
      id: row.id,
      role: "user",
      content: [{ type: "text", status: "complete", data: row.content }],
      createTime: row.createTime,
    }));

    res.status(200).send(success({ history }));
  },
);
