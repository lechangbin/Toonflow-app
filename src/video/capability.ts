import { z } from "zod";

export const videoCapabilityIdSchema = z.enum([
  "text-to-video",
  "image-to-video",
  "first-last-frame",
  "keyframe-to-video",
]);

export type VideoCapabilityId = z.infer<typeof videoCapabilityIdSchema>;

export const videoInputRoleSchema = z.enum([
  "source-image",
  "first-frame",
  "intermediate-keyframe",
  "last-frame",
]);

export type VideoInputRole = z.infer<typeof videoInputRoleSchema>;

const videoInputSchema = z
  .object({
    role: videoInputRoleSchema,
    mediaType: z.literal("image"),
    required: z.boolean(),
  })
  .strict();

export const videoAudioContractSchema = z.discriminatedUnion("generation", [
  z
    .object({
      generation: z.literal("none"),
      policy: z.literal("none"),
    })
    .strict(),
  z
    .object({
      generation: z.literal("native"),
      policy: z.enum(["always", "optional"]),
    })
    .strict(),
]);

export type VideoAudioContract = z.infer<typeof videoAudioContractSchema>;

const integerRangeDurationsSchema = z
  .object({
    kind: z.literal("integer-range"),
    min: z.number().int().positive(),
    max: z.number().int().positive(),
    step: z.number().int().positive(),
  })
  .strict()
  .refine((value) => value.max >= value.min, "duration max must be greater than or equal to min");

const valueDurationsSchema = z
  .object({
    kind: z.literal("values"),
    values: z.array(z.number().int().positive()).nonempty(),
  })
  .strict()
  .transform((value) => ({ ...value, values: [...new Set(value.values)] }));

export const videoOutputPresetSchema = z
  .object({
    id: z.string().min(1),
    resolution: z.string().regex(/^\d+p$/, "resolution must be lower-case, for example 720p"),
    durations: z.union([integerRangeDurationsSchema, valueDurationsSchema]),
    aspectRatios: z.array(z.enum(["16:9", "9:16"])).nonempty(),
  })
  .strict();

export type VideoOutputPreset = z.infer<typeof videoOutputPresetSchema>;

const capabilityBaseShape = {
  promptProfileId: z.string().min(1),
  audio: videoAudioContractSchema,
  outputPresets: z.array(videoOutputPresetSchema).nonempty(),
};

const textToVideoCapabilitySchema = z
  .object({
    id: z.literal("text-to-video"),
    ...capabilityBaseShape,
    inputs: z.tuple([]),
  })
  .strict();

const imageToVideoCapabilitySchema = z
  .object({
    id: z.literal("image-to-video"),
    ...capabilityBaseShape,
    inputs: z.tuple([
      videoInputSchema.extend({
        role: z.literal("source-image"),
        required: z.literal(true),
      }),
    ]),
  })
  .strict();

const firstLastFrameCapabilitySchema = z
  .object({
    id: z.literal("first-last-frame"),
    ...capabilityBaseShape,
    inputs: z.tuple([
      videoInputSchema.extend({ role: z.literal("first-frame"), required: z.literal(true) }),
      videoInputSchema.extend({ role: z.literal("last-frame"), required: z.literal(true) }),
    ]),
  })
  .strict();

const keyframeToVideoCapabilitySchema = z
  .object({
    id: z.literal("keyframe-to-video"),
    ...capabilityBaseShape,
    inputs: z.tuple([
      videoInputSchema.extend({ role: z.literal("first-frame"), required: z.literal(true) }),
      videoInputSchema.extend({ role: z.literal("intermediate-keyframe"), required: z.literal(false) }),
      videoInputSchema.extend({ role: z.literal("last-frame"), required: z.literal(true) }),
    ]),
    transitions: z
      .object({
        kind: z.literal("adjacent-keyframes"),
      })
      .strict(),
  })
  .strict();

export const videoCapabilitySchema = z.discriminatedUnion("id", [
  textToVideoCapabilitySchema,
  imageToVideoCapabilitySchema,
  firstLastFrameCapabilitySchema,
  keyframeToVideoCapabilitySchema,
]);

export type VideoCapability = z.infer<typeof videoCapabilitySchema>;

export const videoModelSchema = z
  .object({
    name: z.string().min(1),
    modelName: z.string().min(1),
    type: z.literal("video"),
    associationSkills: z.string().optional(),
    capabilities: z.array(videoCapabilitySchema).nonempty(),
  })
  .strict()
  .superRefine((model, context) => {
    const ids = new Set<string>();
    for (const capability of model.capabilities) {
      if (ids.has(capability.id)) {
        context.addIssue({
          code: "custom",
          path: ["capabilities"],
          message: `duplicate capability ${capability.id}`,
        });
      }
      ids.add(capability.id);

      const presetIds = new Set<string>();
      for (const preset of capability.outputPresets) {
        if (presetIds.has(preset.id)) {
          context.addIssue({
            code: "custom",
            path: ["capabilities", capability.id, "outputPresets"],
            message: `duplicate output preset ${preset.id}`,
          });
        }
        presetIds.add(preset.id);
      }
    }
  });

export type VideoModel = z.infer<typeof videoModelSchema>;

export const resolvedImageSchema = z
  .object({
    mediaType: z.literal("image"),
    base64: z.string().min(1),
  })
  .strict();

export type ResolvedImage = z.infer<typeof resolvedImageSchema>;

export const videoOutputSelectionSchema = z
  .object({
    presetId: z.string().min(1),
    duration: z.number().int().positive(),
    resolution: z.string().regex(/^\d+p$/),
    aspectRatio: z.enum(["16:9", "9:16"]),
  })
  .strict();

export const videoAudioSelectionSchema = z.discriminatedUnion("generation", [
  z.object({ generation: z.literal("none") }).strict(),
  z.object({ generation: z.literal("native"), enabled: z.boolean() }).strict(),
]);

const commandBaseShape = {
  modelId: z.string().min(1),
  prompt: z.string().min(1),
  output: videoOutputSelectionSchema,
  audio: videoAudioSelectionSchema,
  resumeTask: z
    .object({
      videoId: z.string().optional(),
      taskId: z.string().optional(),
      retry: z.number().int().nonnegative().optional(),
    })
    .strict()
    .optional(),
  onTaskCheckpoint: z.function().optional(),
};

const textToVideoCommandSchema = z
  .object({
    capabilityId: z.literal("text-to-video"),
    ...commandBaseShape,
  })
  .strict();

const imageToVideoCommandSchema = z
  .object({
    capabilityId: z.literal("image-to-video"),
    ...commandBaseShape,
    sourceImage: resolvedImageSchema,
  })
  .strict();

const firstLastFrameCommandSchema = z
  .object({
    capabilityId: z.literal("first-last-frame"),
    ...commandBaseShape,
    firstFrame: resolvedImageSchema,
    lastFrame: resolvedImageSchema,
  })
  .strict();

const keyframeToVideoCommandSchema = z
  .object({
    capabilityId: z.literal("keyframe-to-video"),
    ...commandBaseShape,
    firstFrame: resolvedImageSchema,
    intermediateKeyframe: resolvedImageSchema.optional(),
    lastFrame: resolvedImageSchema,
  })
  .strict();

export const validatedVideoGenerationCommandSchema = z.discriminatedUnion("capabilityId", [
  textToVideoCommandSchema,
  imageToVideoCommandSchema,
  firstLastFrameCommandSchema,
  keyframeToVideoCommandSchema,
]);

export type ValidatedVideoGenerationCommand = z.infer<typeof validatedVideoGenerationCommandSchema>;

export class VideoCapabilityError extends Error {
  constructor(
    public readonly code:
      | "MODEL_CONTRACT_INVALID"
      | "CAPABILITY_NOT_SUPPORTED"
      | "OUTPUT_PRESET_NOT_SUPPORTED"
      | "OUTPUT_SELECTION_INVALID"
      | "AUDIO_CONTRACT_MISMATCH"
      | "GENERATION_COMMAND_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "VideoCapabilityError";
  }
}

function durationIsAllowed(preset: VideoOutputPreset, duration: number): boolean {
  if (preset.durations.kind === "values") return preset.durations.values.includes(duration);
  if (duration < preset.durations.min || duration > preset.durations.max) return false;
  return (duration - preset.durations.min) % preset.durations.step === 0;
}

export function parseVideoModel(value: unknown): VideoModel {
  const parsed = videoModelSchema.safeParse(value);
  if (!parsed.success) {
    throw new VideoCapabilityError("MODEL_CONTRACT_INVALID", z.prettifyError(parsed.error));
  }
  return parsed.data;
}

export function validateVideoGenerationCommand(
  modelValue: unknown,
  commandValue: unknown,
): ValidatedVideoGenerationCommand {
  const model = parseVideoModel(modelValue);
  const parsedCommand = validatedVideoGenerationCommandSchema.safeParse(commandValue);
  if (!parsedCommand.success) {
    throw new VideoCapabilityError("GENERATION_COMMAND_INVALID", z.prettifyError(parsedCommand.error));
  }
  const command = parsedCommand.data;
  if (command.modelId !== model.modelName) {
    throw new VideoCapabilityError(
      "GENERATION_COMMAND_INVALID",
      `command model ${command.modelId} does not match ${model.modelName}`,
    );
  }
  const capability = model.capabilities.find((item) => item.id === command.capabilityId);
  if (!capability) {
    throw new VideoCapabilityError(
      "CAPABILITY_NOT_SUPPORTED",
      `${model.modelName} does not support ${command.capabilityId}`,
    );
  }
  const audioMatches =
    (capability.audio.generation === "none" && command.audio.generation === "none") ||
    (capability.audio.generation === "native" &&
      command.audio.generation === "native" &&
      (capability.audio.policy === "optional" || command.audio.enabled));
  if (!audioMatches) {
    throw new VideoCapabilityError(
      "AUDIO_CONTRACT_MISMATCH",
      `${model.modelName}/${capability.id} does not allow ${JSON.stringify(command.audio)} under ${JSON.stringify(capability.audio)}`,
    );
  }
  const preset = capability.outputPresets.find((item) => item.id === command.output.presetId);
  if (!preset) {
    throw new VideoCapabilityError(
      "OUTPUT_PRESET_NOT_SUPPORTED",
      `${model.modelName}/${capability.id} does not expose preset ${command.output.presetId}`,
    );
  }
  if (
    preset.resolution !== command.output.resolution ||
    !preset.aspectRatios.includes(command.output.aspectRatio) ||
    !durationIsAllowed(preset, command.output.duration)
  ) {
    throw new VideoCapabilityError(
      "OUTPUT_SELECTION_INVALID",
      `output does not match preset ${preset.id} for ${model.modelName}/${capability.id}`,
    );
  }
  return command;
}
