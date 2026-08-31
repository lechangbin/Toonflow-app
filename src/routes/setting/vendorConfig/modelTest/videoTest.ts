import express from "express";
import { z } from "zod";

import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { getDefaultConfiguredVendor } from "@/vendor";
import { normalizeHttpResult } from "@/utils/imageGeneration";
import {
  validateVideoGenerationCommand,
  videoAudioSelectionSchema,
  videoCapabilityIdSchema,
  videoInputRoleSchema,
  videoOutputSelectionSchema,
} from "@/video/capability";

const router = express.Router();

const requestSchema = z
  .object({
    vendorId: z.string().min(1),
    modelId: z.string().min(1),
    capabilityId: videoCapabilityIdSchema,
    prompt: z.string().min(1),
    output: videoOutputSelectionSchema,
    audio: videoAudioSelectionSchema,
    images: z.array(
      z
        .object({
          role: videoInputRoleSchema,
          base64: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export default router.post("/", async (req, res) => {
  try {
    const input = requestSchema.parse(req.body);
    const vendor = getDefaultConfiguredVendor();
    const model = (await vendor.inspectVendor(input.vendorId)).models.find((item) => item.modelName === input.modelId);
    if (!model) return res.status(404).send(error("未找到测试模型"));
    const images = new Map(input.images.map((image) => [image.role, { mediaType: "image" as const, base64: image.base64 }]));
    const base = {
      capabilityId: input.capabilityId,
      modelId: input.modelId,
      prompt: input.prompt,
      output: input.output,
      audio: input.audio,
    };
    const command = validateVideoGenerationCommand(
      model,
      input.capabilityId === "text-to-video"
        ? base
        : input.capabilityId === "image-to-video"
          ? { ...base, sourceImage: images.get("source-image") }
          : input.capabilityId === "first-last-frame"
            ? { ...base, firstFrame: images.get("first-frame"), lastFrame: images.get("last-frame") }
            : {
                ...base,
                firstFrame: images.get("first-frame"),
                intermediateKeyframe: images.get("intermediate-keyframe"),
                lastFrame: images.get("last-frame"),
              },
    );
    const result = await vendor.generateVideo({
      target: { vendorId: input.vendorId, modelId: input.modelId },
      input: command,
    });
    await u.oss.writeFile("test.mp4", await normalizeHttpResult(result));
    res.status(200).send(success(await u.oss.getFileUrl("test.mp4")));
  } catch (cause) {
    res.status(400).send(error(u.error(cause).message));
  }
});
