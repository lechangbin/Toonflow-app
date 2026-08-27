import express from "express";
import { z } from "zod";

import { success } from "@/lib/responseFormat";
import { startVideoGenerationBatch, videoGenerationItemSchema } from "@/video/production";

const router = express.Router();

const requestSchema = z
  .object({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    requestedBy: z.enum(["user", "project-agent"]).default("user"),
    item: videoGenerationItemSchema,
  })
  .strict();

export default router.post("/", async (req, res, next) => {
  try {
    const request = requestSchema.parse(req.body);
    const started = await startVideoGenerationBatch({
      projectId: request.projectId,
      scriptId: request.scriptId,
      requestedBy: request.requestedBy,
      items: [request.item],
    });
    void started.completion.catch((error) => console.error("Video Production Action completion update failed", error));
    res.status(200).send(success({ actionId: started.actionId, ...started.tasks[0] }));
  } catch (error) {
    next(error);
  }
});
