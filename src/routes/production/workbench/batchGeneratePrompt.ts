import express from "express";
import pLimit from "p-limit";
import { z } from "zod";

import { success } from "@/lib/responseFormat";
import { generateVideoPromptRequestSchema, generateVideoPromptRevision } from "@/video/promptGeneration";
import { assertWorkbenchUserOrigin, WorkbenchAgentOriginRejectedError } from
  "@/video/workbenchOrigin";

const batchSchema = z
  .object({
    items: z.array(generateVideoPromptRequestSchema).nonempty(),
    concurrentCount: z.number().int().min(1).max(10).default(5),
  })
  .strict();

export function createBatchGeneratePromptRouter(
  generate: typeof generateVideoPromptRevision = generateVideoPromptRevision,
) {
  const router = express.Router();
  return router.post("/", async (req, res, next) => {
    try {
      const input = batchSchema.parse(req.body);
      input.items.forEach(assertWorkbenchUserOrigin);
      const limit = pLimit(input.concurrentCount);
      const revisions = await Promise.all(input.items.map((item) => limit(() => generate(item))));
      res.status(200).send(success(revisions));
    } catch (error) {
      if (error instanceof WorkbenchAgentOriginRejectedError || error instanceof z.ZodError) {
        res.status(422).send({ message: "Video prompt batch request is invalid" });
        return;
      }
      next(error);
    }
  });
}

export default createBatchGeneratePromptRouter();
