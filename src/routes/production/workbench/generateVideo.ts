import express from "express";
import { z } from "zod";

import { success } from "@/lib/responseFormat";
import { startVideoGenerationBatch, videoGenerationItemSchema } from "@/video/production";
import { assertWorkbenchUserOrigin, WorkbenchAgentOriginRejectedError } from
  "@/video/workbenchOrigin";

const requestSchema = z
  .object({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    requestedBy: z.literal("user").default("user"),
    item: videoGenerationItemSchema,
  })
  .strict();

export function createGenerateVideoRouter(
  start: typeof startVideoGenerationBatch = startVideoGenerationBatch,
) {
  const router = express.Router();
  return router.post("/", async (req, res, next) => {
    try {
      const request = requestSchema.parse(req.body);
      assertWorkbenchUserOrigin(request);
      const started = await start({
        projectId: request.projectId,
        scriptId: request.scriptId,
        requestedBy: request.requestedBy,
        items: [request.item],
      });
      void started.completion.catch(() => console.error("Video Production Action completion update failed"));
      res.status(200).send(success({ actionId: started.actionId, ...started.tasks[0] }));
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

export default createGenerateVideoRouter();
