import express from "express";
import u from "@/utils";
import { getDefaultConfiguredVendor } from "@/vendor";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getRuntimePrompt, runtimePromptKeys } from "@/prompts/runtime";
import { getDatabaseRuntime } from "@/database";
import { normalizeAiRegex, resolveRegexAnalysisTarget } from "@/script/regexAnalysis";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    content: z.string(),
  }),
  async (req, res) => {
    try {
      const { content } = req.body;
      const vendor = getDefaultConfiguredVendor();
      const [systemPrompt, target] = await Promise.all([
        getRuntimePrompt(runtimePromptKeys.scriptRegex),
        getDatabaseRuntime().work((database) => resolveRegexAnalysisTarget(database, vendor)),
      ]);
      const resText = await vendor.invokeText({
        target,
        input: {
          system: systemPrompt,
          messages: [{ role: "user", content: content.slice(0, 2000) }],
        },
      });
      res.status(200).send(success(normalizeAiRegex(resText.text || "")));
    } catch (cause) {
      res.status(400).send(error(u.error(cause).message));
    }
  },
);
