import express from "express";
import { z } from "zod";

import { success } from "@/lib/responseFormat";
import { generateVideoPromptRequestSchema, generateVideoPromptRevision } from "@/video/promptGeneration";
import { assertWorkbenchUserOrigin, WorkbenchAgentOriginRejectedError } from
  "@/video/workbenchOrigin";
import { assertWorkbenchProjectOwner, WorkbenchOwnerRejectedError,
  type WorkbenchOwnerCheck } from "@/video/workbenchOwner";

export function createGenerateVideoPromptRouter(
  generate: typeof generateVideoPromptRevision = generateVideoPromptRevision,
  authorize: WorkbenchOwnerCheck = assertWorkbenchProjectOwner,
) {
  const router = express.Router();
  return router.post("/", async (req, res, next) => {
    try {
      const input = generateVideoPromptRequestSchema.parse(req.body);
      assertWorkbenchUserOrigin(input);
      await authorize(req, input.projectId);
      res.status(200).send(success(await generate(input)));
    } catch (error) {
      if (error instanceof WorkbenchOwnerRejectedError) {
        res.status(403).send({ message: error.message });
        return;
      }
      if (error instanceof WorkbenchAgentOriginRejectedError || error instanceof z.ZodError) {
        res.status(422).send({ message: "Video prompt request is invalid" });
        return;
      }
      next(error);
    }
  });
}

export default createGenerateVideoPromptRouter();
