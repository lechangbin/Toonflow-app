import express from "express";

import { success } from "@/lib/responseFormat";
import { startVideoGenerationBatch, videoGenerationBatchRequestSchema } from "@/video/production";

const router = express.Router();

export default router.post("/", async (req, res, next) => {
  try {
    const request = videoGenerationBatchRequestSchema.parse(req.body);
    const started = await startVideoGenerationBatch(request);
    void started.completion.catch((error) => console.error("Video Production Action completion update failed", error));
    res.status(200).send(success({ actionId: started.actionId, tasks: started.tasks }));
  } catch (error) {
    next(error);
  }
});
