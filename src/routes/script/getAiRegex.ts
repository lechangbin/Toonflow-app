import express from "express";
import { getDefaultConfiguredVendor } from "@/vendor";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getRuntimePrompt, runtimePromptKeys } from "@/prompts/runtime";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    content: z.string(),
  }),
  async (req, res) => {
    const { content } = req.body;
    const systemPrompt = await getRuntimePrompt(runtimePromptKeys.scriptRegex);

    const resText = await getDefaultConfiguredVendor().invokeText({
      target: { kind: "logical", key: "universalAi" },
      input: {
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: content.slice(0, 2000),
          },
        ],
      },
    });
    const result = (resText.text || "").trim();
    res.status(200).send(success(result));
  },
);
