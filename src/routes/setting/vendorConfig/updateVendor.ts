import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { transform } from "sucrase";
const router = express.Router();

const vendorConfigSchema = z.object({
  id: z.string(),
  author: z.string(),
  description: z.string().optional(),
  name: z.string(),
  icon: z.string().optional(),
  inputs: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(["text", "password", "url"]),
      required: z.boolean(),
      placeholder: z.string().optional(),
    }),
  ),
  inputValues: z.record(z.string(), z.string()),
  models: z.array(
    z.discriminatedUnion("type", [
      z.object({
        name: z.string(),
        modelName: z.string(),
        type: z.literal("text"),
        multimodal: z.boolean(),
        tool: z.boolean(),
      }),
      z.object({
        name: z.string(),
        modelName: z.string(),
        type: z.literal("image"),
        mode: z.array(z.enum(["text", "singleImage", "multiReference"])),
      }),
      z.object({
        name: z.string(),
        modelName: z.string(),
        type: z.literal("video"),
        mode: z.array(
          z.union([
            z.enum([
              "singleImage",
              "multiImage",
              "gridImage",
              "startEndRequired",
              "endFrameOptional",
              "startFrameOptional",
              "text",
              "audioReference",
              "videoReference",
            ]),
            z.array(z.enum(["video", "image", "audio", "text"])),
          ]),
        ),
        audio: z.union([z.literal("optional"), z.boolean()]),
        durationResolutionMap: z.array(
          z.object({
            duration: z.array(z.number()),
            resolution: z.array(z.string()),
          }),
        ),
      }),
    ]),
  ),
});

export default router.post(
  "/",
  validateFields({
    id: z.string(),
    inputValues: z.record(z.string(), z.string()),
    inputs: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        type: z.enum(["text", "password", "url"]),
        required: z.boolean(),
        placeholder: z.string().optional(),
      }),
    ),
    models: z.array(
      z.discriminatedUnion("type", [
        z.object({
          name: z.string(),
          modelName: z.string(),
          type: z.literal("text"),
          multimodal: z.boolean(),
          tool: z.boolean(),
        }),
        z.object({
          name: z.string(),
          modelName: z.string(),
          type: z.literal("image"),
          mode: z.array(z.enum(["text", "singleImage", "multiReference"])),
        }),
        z.object({
          name: z.string(),
          modelName: z.string(),
          type: z.literal("video"),
          mode: z.array(
            z.union([
              z.enum(["singleImage", "multiImage", "gridImage", "startEndRequired", "endFrameOptional", "startFrameOptional", "text"]),
              z.array(z.enum(["audioReference", "videoReference", "textReference", "imageReference"])),
            ]),
          ),
          audio: z.union([z.literal("optional"), z.boolean()]),
          durationResolutionMap: z.array(
            z.object({
              duration: z.array(z.number()),
              resolution: z.array(z.string()),
            }),
          ),
        }),
      ]),
    ),
  }),
  async (req, res) => {
    const { id, name, models, inputs, inputValues, icon } = req.body;

    await u
      .db("o_vendorConfig")
      .where("id", id)
      .update({
        inputs: JSON.stringify(inputs),
        inputValues: JSON.stringify(inputValues),
        models: JSON.stringify(models),
      });
    res.status(200).send(success("更新成功"));
  },
);
