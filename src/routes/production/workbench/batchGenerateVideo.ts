import express from "express";
import { z } from "zod";

import { success } from "@/lib/responseFormat";
import { startVideoGenerationBatch, videoGenerationBatchRequestSchema } from "@/video/production";
import { assertWorkbenchUserOrigin, WorkbenchAgentOriginRejectedError } from
  "@/video/workbenchOrigin";

export function createBatchGenerateVideoRouter(
  start: typeof startVideoGenerationBatch = startVideoGenerationBatch,
) {
  const router = express.Router();
  return router.post("/", async (req, res, next) => {
    try {
      const request = videoGenerationBatchRequestSchema.parse(req.body);
      assertWorkbenchUserOrigin(request);
      const started = await start(request);
      void started.completion.catch(() => console.error("Video Production Action completion update failed"));
      res.status(200).send(success({ actionId: started.actionId, tasks: started.tasks }));
    } catch (error) {
      if (error instanceof WorkbenchAgentOriginRejectedError) {
        res.status(422).send({ message: error.message });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(422).send({ message: "Video generation request is invalid" });
        return;
      }
      next(error);
    }
  });
}

export default createBatchGenerateVideoRouter();
