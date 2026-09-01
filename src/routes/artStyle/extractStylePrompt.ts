import express from "express";
import u from "@/utils";
import { getDefaultConfiguredVendor } from "@/vendor";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getRuntimePrompt, runtimePromptKeys } from "@/prompts/runtime";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    images: z.array(z.string()),
  }),
  async (req, res) => {
    const { images } = req.body;
    try {
      const resText = await getDefaultConfiguredVendor().invokeText({
        target: { kind: "logical", key: "universalAi" },
        input: {
          system: await getRuntimePrompt(runtimePromptKeys.artStyleExtraction),
          messages: [
            {
              role: "user",
              content: [
                ...images.map((image: string) => ({
                  type: "image" as const,
                  image,
                })),
              ],
            },
          ],
        },
      });
      res.status(200).send(success(resText.text));
    } catch (e) {
      const err = u.error(e);
      res.status(500).send({ message: err.message });
    }
  },
);
