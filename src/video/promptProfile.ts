import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { videoCapabilityIdSchema, videoInputRoleSchema } from "./capability";

export const promptStrategySchema = z.enum(["standard", "standard-with-guidance", "custom"]);
export type PromptStrategy = z.infer<typeof promptStrategySchema>;

const draftSectionSchema = z.enum([
  "subject",
  "motion",
  "scene",
  "camera",
  "lighting",
  "style",
  "continuity",
  "transition",
  "audio",
  "constraints",
]);

export type DraftSection = z.infer<typeof draftSectionSchema>;

const promptProfileMetadataSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+-v[1-9]\d*$/),
    schemaVersion: z.literal(1),
    capabilityId: videoCapabilityIdSchema,
    defaultStrategy: z.enum(["standard", "standard-with-guidance"]),
    draftSections: z.array(draftSectionSchema).nonempty(),
    attribution: z.string().min(1),
  })
  .strict()
  .superRefine((metadata, context) => {
    if (!metadata.draftSections.includes("subject")) {
      context.addIssue({ code: "custom", path: ["draftSections"], message: "draft sections must include subject" });
    }
    if (new Set(metadata.draftSections).size !== metadata.draftSections.length) {
      context.addIssue({ code: "custom", path: ["draftSections"], message: "draft sections must be unique" });
    }
    if (metadata.capabilityId === "text-to-video" && metadata.draftSections.includes("transition")) {
      context.addIssue({
        code: "custom",
        path: ["draftSections"],
        message: "text-to-video profiles cannot declare a keyframe transition section",
      });
    }
    if (
      (metadata.capabilityId === "first-last-frame" || metadata.capabilityId === "keyframe-to-video") &&
      !metadata.draftSections.includes("transition")
    ) {
      context.addIssue({
        code: "custom",
        path: ["draftSections"],
        message: `${metadata.capabilityId} profiles must declare a transition section`,
      });
    }
  });

export interface VideoPromptProfile extends z.infer<typeof promptProfileMetadataSchema> {
  guidance: string;
  filePath: string;
}

const referenceRoleSchema = z
  .object({
    role: videoInputRoleSchema,
    intent: z.string().min(1),
    preserve: z.array(z.string().min(1)).default([]),
    exclude: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const videoPromptBriefSchema = z
  .object({
    subject: z.string().min(1),
    motion: z.string().optional(),
    scene: z.string().optional(),
    camera: z.string().optional(),
    lighting: z.string().optional(),
    style: z.string().optional(),
    continuity: z.string().optional(),
    transition: z.string().optional(),
    audio: z.string().optional(),
    constraints: z.array(z.string().min(1)).default([]),
    references: z.array(referenceRoleSchema).default([]),
  })
  .strict();

export type VideoPromptBrief = z.infer<typeof videoPromptBriefSchema>;

const draftShape = Object.fromEntries(
  draftSectionSchema.options.map((section) => [
    section,
    section === "subject" ? z.string().trim().min(1) : z.string().trim().min(1).optional(),
  ]),
) as Record<DraftSection, z.ZodString | z.ZodOptional<z.ZodString>>;

export const videoPromptDraftSchema = z.object(draftShape).strict();
export type VideoPromptDraft = z.infer<typeof videoPromptDraftSchema>;

export class PromptProfileError extends Error {
  constructor(
    public readonly code:
      | "PROFILE_FORMAT_INVALID"
      | "PROFILE_ID_MISMATCH"
      | "PROFILE_DUPLICATE"
      | "PROFILE_NOT_FOUND"
      | "BRIEF_INVALID"
      | "DRAFT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "PromptProfileError";
  }
}

function parseScalar(value: string): string | number | string[] {
  const trimmed = value.trim();
  if (/^[1-9]\d*$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return trimmed.replace(/^(['"])([\s\S]*)\1$/, "$2");
}

export function parseVideoPromptProfile(content: string, filePath: string): VideoPromptProfile {
  const match = content.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n([\s\S]+)$/);
  if (!match) {
    throw new PromptProfileError("PROFILE_FORMAT_INVALID", `${filePath}: expected frontmatter followed by Markdown guidance`);
  }

  const rawMetadata: Record<string, unknown> = {};
  for (const [lineNumber, line] of match[1].split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const pair = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.+)$/);
    if (!pair) {
      throw new PromptProfileError("PROFILE_FORMAT_INVALID", `${filePath}:${lineNumber + 2}: invalid frontmatter line`);
    }
    if (pair[1] in rawMetadata) {
      throw new PromptProfileError("PROFILE_FORMAT_INVALID", `${filePath}:${lineNumber + 2}: duplicate key ${pair[1]}`);
    }
    rawMetadata[pair[1]] = parseScalar(pair[2]);
  }

  const parsed = promptProfileMetadataSchema.safeParse(rawMetadata);
  if (!parsed.success) {
    throw new PromptProfileError("PROFILE_FORMAT_INVALID", `${filePath}: ${z.prettifyError(parsed.error)}`);
  }
  const guidance = match[2].trim();
  if (!guidance) {
    throw new PromptProfileError("PROFILE_FORMAT_INVALID", `${filePath}: Markdown guidance cannot be empty`);
  }
  return { ...parsed.data, guidance, filePath };
}

export class VideoPromptProfileRegistry {
  private readonly profiles = new Map<string, VideoPromptProfile>();

  register(profile: VideoPromptProfile): void {
    if (this.profiles.has(profile.id)) {
      throw new PromptProfileError("PROFILE_DUPLICATE", `duplicate Prompt Profile ${profile.id}`);
    }
    this.profiles.set(profile.id, profile);
  }

  get(id: string): VideoPromptProfile {
    const profile = this.profiles.get(id);
    if (!profile) throw new PromptProfileError("PROFILE_NOT_FOUND", `Prompt Profile ${id} is not registered`);
    return profile;
  }

  list(): VideoPromptProfile[] {
    return [...this.profiles.values()];
  }

  static load(rootDir: string): VideoPromptProfileRegistry {
    const registry = new VideoPromptProfileRegistry();
    const visit = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(fullPath);
        else if (entry.isFile() && entry.name.endsWith(".md")) {
          const profile = parseVideoPromptProfile(fs.readFileSync(fullPath, "utf8"), fullPath);
          const relativeId = path.relative(rootDir, fullPath).replace(/\\/g, "/").replace(/\.md$/, "");
          if (relativeId !== profile.id) {
            throw new PromptProfileError(
              "PROFILE_ID_MISMATCH",
              `${fullPath}: declared id ${profile.id} must match relative path ${relativeId}`,
            );
          }
          registry.register(profile);
        }
      }
    };
    visit(rootDir);
    return registry;
  }
}

export function createVideoPromptDraftInstruction(
  profile: VideoPromptProfile,
  briefValue: unknown,
  strategy: Exclude<PromptStrategy, "custom"> = profile.defaultStrategy,
): string {
  const brief = videoPromptBriefSchema.safeParse(briefValue);
  if (!brief.success) throw new PromptProfileError("BRIEF_INVALID", z.prettifyError(brief.error));
  const guidance = strategy === "standard-with-guidance" ? `\nProfile guidance:\n${profile.guidance}\n` : "";
  return [
    `Create one ${profile.capabilityId} video prompt draft.`,
    "Return one JSON object only. subject is required; use only these string keys:",
    profile.draftSections.join(", "),
    "Do not invent dialogue, music, or sound when the brief does not request it.",
    "Reference roles are semantic; do not invent provider-specific reference tags.",
    guidance,
    `PromptBrief:\n${JSON.stringify(brief.data, null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderVideoPrompt(profile: VideoPromptProfile, draftValue: unknown): string {
  const parsed = videoPromptDraftSchema.safeParse(draftValue);
  if (!parsed.success) throw new PromptProfileError("DRAFT_INVALID", z.prettifyError(parsed.error));
  const undeclared = Object.keys(parsed.data).filter(
    (key) => parsed.data[key as DraftSection] && !profile.draftSections.includes(key as DraftSection),
  );
  if (undeclared.length) {
    throw new PromptProfileError("DRAFT_INVALID", `draft uses sections not declared by ${profile.id}: ${undeclared.join(", ")}`);
  }
  const rendered = profile.draftSections
    .map((section) => parsed.data[section])
    .filter((value): value is string => !!value)
    .join("\n");
  if (!rendered) throw new PromptProfileError("DRAFT_INVALID", "draft has no renderable sections");
  return rendered;
}
