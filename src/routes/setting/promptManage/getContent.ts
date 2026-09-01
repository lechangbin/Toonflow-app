import express from "express";
import { z } from "zod";

import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { readPromptCatalogEntry } from "@/prompts/catalog";
import getPath from "@/utils/getPath";

const router = express.Router();

export default router.post("/", validateFields({ key: z.string().min(1) }), async (req, res) => {
  const content = await getDatabaseRuntime().work((database) => readPromptCatalogEntry(database, getPath(), req.body.key));
  res.status(200).send(success(content));
});
