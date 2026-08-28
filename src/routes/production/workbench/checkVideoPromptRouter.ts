import express from "express";
import type { Knex } from "knex";
import { z } from "zod";

import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { readVideoPromptStatuses } from "@/video/promptStatus";

export function createCheckVideoPromptRouter(db: Knex) {
  const router = express.Router();

  return router.post(
    "/",
    validateFields({
      projectId: z.number(),
      scriptId: z.number(),
      trackIds: z.array(z.number()),
    }),
    async (req, res) => {
      const promptStatuses = await readVideoPromptStatuses(db, req.body);
      res.status(200).send(success(promptStatuses));
    },
  );
}
