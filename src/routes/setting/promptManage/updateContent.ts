import express from "express";
import { z } from "zod";

import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { updatePromptCatalogEntry } from "@/prompts/catalog";
import getPath from "@/utils/getPath";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ key: z.string().min(1), content: z.string().min(1) }),
  async (req, res) => {
    await getDatabaseRuntime().work((database) =>
      updatePromptCatalogEntry(database, getPath(), req.body.key, req.body.content),
    );
    res.status(200).send(success());
  },
);
