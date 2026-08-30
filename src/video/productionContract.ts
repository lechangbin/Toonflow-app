import { z } from "zod";

import {
  videoAudioSelectionSchema,
  videoCapabilityIdSchema,
  videoInputRoleSchema,
  videoOutputSelectionSchema,
  type VideoCapabilityId,
  type VideoInputRole,
} from "./capability";

export const videoTrackInputReferenceSchema = z
  .object({
    role: videoInputRoleSchema,
    source: z.enum(["storyboard", "asset", "uploaded-media"]),
    sourceId: z.number().int().positive().optional(),
    filePath: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((reference, context) => {
    if (reference.source === "uploaded-media" && !reference.filePath) {
      context.addIssue({ code: "custom", path: ["filePath"], message: "uploaded-media requires filePath" });
    }
    if (reference.source === "uploaded-media" && reference.sourceId) {
      context.addIssue({ code: "custom", path: ["sourceId"], message: "uploaded-media cannot include sourceId" });
    }
    if (reference.source !== "uploaded-media" && !reference.sourceId) {
      context.addIssue({ code: "custom", path: ["sourceId"], message: `${reference.source} requires sourceId` });
    }
    if (reference.source !== "uploaded-media" && reference.filePath) {
      context.addIssue({ code: "custom", path: ["filePath"], message: `${reference.source} cannot include filePath` });
    }
  });

export type VideoTrackInputReference = z.infer<typeof videoTrackInputReferenceSchema>;

export const videoTrackSelectionSchema = z
  .object({
    vendorId: z.string().min(1),
    modelId: z.string().min(1),
    capabilityId: videoCapabilityIdSchema,
    inputs: z.array(videoTrackInputReferenceSchema),
    output: videoOutputSelectionSchema,
    audio: videoAudioSelectionSchema,
  })
  .strict();

export type VideoTrackSelection = z.infer<typeof videoTrackSelectionSchema>;

export function validateVideoTrackInputReferences(
  capability: {
    id: VideoCapabilityId;
    inputs: readonly { role: VideoInputRole; mediaType: "image"; required: boolean }[];
  },
  references: VideoTrackInputReference[],
): void {
  const declaredRoles = new Map(capability.inputs.map((input) => [input.role, input]));
  const suppliedRoles = new Set<string>();
  for (const reference of references) {
    if (suppliedRoles.has(reference.role)) throw new Error(`输入角色 ${reference.role} 只能出现一次`);
    suppliedRoles.add(reference.role);
    if (!declaredRoles.has(reference.role)) {
      throw new Error(`${capability.id} 不接受输入角色 ${reference.role}`);
    }
  }
  for (const input of capability.inputs) {
    if (input.required && !suppliedRoles.has(input.role)) {
      throw new Error(`${capability.id} 缺少必需输入角色 ${input.role}`);
    }
  }
}

export const videoGenerationItemSchema = z
  .object({
    trackId: z.number().int().positive(),
    vendorId: z.string().min(1),
    modelId: z.string().min(1),
    capabilityId: videoCapabilityIdSchema,
    inputs: z.array(videoTrackInputReferenceSchema),
    output: videoOutputSelectionSchema,
    audio: videoAudioSelectionSchema,
    promptRevisionId: z.number().int().positive(),
  })
  .strict();

export type VideoGenerationItem = z.infer<typeof videoGenerationItemSchema>;

export const videoGenerationBatchRequestSchema = z
  .object({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    requestedBy: z.enum(["user", "project-agent"]),
    items: z.array(videoGenerationItemSchema).nonempty(),
  })
  .strict()
  .superRefine((request, context) => {
    const trackIds = new Set<number>();
    for (const [index, item] of request.items.entries()) {
      if (trackIds.has(item.trackId)) {
        context.addIssue({ code: "custom", path: ["items", index, "trackId"], message: "each Track may appear once per action" });
      }
      trackIds.add(item.trackId);
    }
  });

export type VideoGenerationBatchRequest = z.infer<typeof videoGenerationBatchRequestSchema>;
