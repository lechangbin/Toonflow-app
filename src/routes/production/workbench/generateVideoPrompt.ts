import express from "express";

import { success } from "@/lib/responseFormat";
import { generateVideoPromptRequestSchema, generateVideoPromptRevision } from "@/video/promptGeneration";

const router = express.Router();

export default router.post("/", async (req, res, next) => {
  try {
    const input = generateVideoPromptRequestSchema.parse(req.body);
    res.status(200).send(success(await generateVideoPromptRevision(input)));
  } catch (error) {
    next(error);
  }
});
