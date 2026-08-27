import express from "express";
import pLimit from "p-limit";
import { z } from "zod";

import { success } from "@/lib/responseFormat";
import { generateVideoPromptRequestSchema, generateVideoPromptRevision } from "@/video/promptGeneration";

const router = express.Router();

const batchSchema = z
  .object({
    items: z.array(generateVideoPromptRequestSchema).nonempty(),
    concurrentCount: z.number().int().min(1).max(10).default(5),
  })
  .strict();

export default router.post("/", async (req, res, next) => {
  try {
    const input = batchSchema.parse(req.body);
    const limit = pLimit(input.concurrentCount);
    const revisions = await Promise.all(input.items.map((item) => limit(() => generateVideoPromptRevision(item))));
    res.status(200).send(success(revisions));
  } catch (error) {
    next(error);
  }
});
