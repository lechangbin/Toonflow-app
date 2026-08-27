import { z } from "zod";

import { videoModelSchema } from "./capability";

const textModelSchema = z
  .object({
    name: z.string().min(1),
    modelName: z.string().min(1),
    type: z.literal("text"),
    think: z.boolean(),
  })
  .strict();

const imageModelSchema = z
  .object({
    name: z.string().min(1),
    modelName: z.string().min(1),
    type: z.literal("image"),
    mode: z.array(z.enum(["text", "singleImage", "multiReference"])).nonempty(),
    associationSkills: z.string().optional(),
    maxReferenceImages: z.number().int().positive().optional(),
  })
  .strict();

const ttsModelSchema = z
  .object({
    name: z.string().min(1),
    modelName: z.string().min(1),
    type: z.literal("tts"),
    voices: z.array(z.object({ title: z.string(), voice: z.string() }).strict()),
  })
  .strict();

export const vendorModelSchema = z.discriminatedUnion("type", [
  textModelSchema,
  imageModelSchema,
  videoModelSchema,
  ttsModelSchema,
]);
