import express from "express";

import { success } from "@/lib/responseFormat";
import { createCustomVideoPromptRevision, customVideoPromptRevisionSchema } from "@/video/promptGeneration";

const router = express.Router();

export default router.post("/", async (req, res, next) => {
  try {
    const input = customVideoPromptRevisionSchema.parse(req.body);
    res.status(200).send(success(await createCustomVideoPromptRevision(input)));
  } catch (error) {
    next(error);
  }
});
