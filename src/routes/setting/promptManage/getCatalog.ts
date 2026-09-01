import express from "express";

import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { listPromptCatalog } from "@/prompts/catalog";
import getPath from "@/utils/getPath";

const router = express.Router();

export default router.post("/", async (_req, res) => {
  const entries = await getDatabaseRuntime().work((database) => listPromptCatalog(database, getPath()));
  res.status(200).send(success(entries));
});
