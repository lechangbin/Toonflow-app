import express from "express";
import { z } from "zod";

import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { resetPromptCatalogEntry } from "@/prompts/catalog";

const router = express.Router();

export default router.post("/", validateFields({ key: z.string().min(1) }), async (req, res) => {
  await getDatabaseRuntime().work((database) => resetPromptCatalogEntry(database, req.body.key));
  res.status(200).send(success());
});
