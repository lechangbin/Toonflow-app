import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

function normalizeRole(role?: string | null): "user" | "assistant" {
  return role?.startsWith("assistant") ? "assistant" : "user";
}

function getAssistantName(role?: string | null): string | undefined {
  if (!role?.startsWith("assistant:")) return undefined;
  return role.split(":")[1] || "assistant";
}

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
      .select("id", "role", "content", "createTime");

    const history = rows.map((row) => ({
      id: row.id,
      role: normalizeRole(row.role),
      name: getAssistantName(row.role),
      content: [{ type: "markdown", status: "complete", data: row.content }],
      createTime: row.createTime,
    }));

    res.status(200).send(success(history));
  },
);
