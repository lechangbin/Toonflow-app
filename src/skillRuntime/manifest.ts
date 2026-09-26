import { z } from "zod";

export const SKILL_MANIFEST_SCHEMA_VERSION = "toonflow.skill-manifest.v1" as const;
const identifier = z.string().regex(/^[A-Za-z0-9._:@-]{1,128}$/);

export const skillManifestSchema = z.strictObject({
  schemaVersion: z.literal(SKILL_MANIFEST_SCHEMA_VERSION),
  skillId: identifier,
  semanticVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  compatibleRoles: z.array(identifier).min(1).max(10),
  intents: z.array(identifier).min(1).max(30),
  dependencies: z.array(z.strictObject({ skillId: identifier,
    semanticVersion: z.string().regex(/^\d+\.\d+\.\d+$/) })).max(20),
  requestedTools: z.array(identifier).max(30),
  requestedCapabilities: z.array(identifier).max(30),
  resources: z.array(z.strictObject({ id: identifier, mediaType: z.enum(["text/markdown", "application/json"]),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/) })).max(50),
  routing: z.strictObject({ priority: z.number().int().min(0).max(1000),
    keywords: z.array(z.string().trim().min(1).max(80)).max(30) }),
  attribution: z.string().trim().min(1).max(200),
}).superRefine((value, context) => {
  const unique = (values: readonly string[]) => new Set(values).size === values.length;
  if (!unique(value.compatibleRoles) || !unique(value.intents)
    || !unique(value.requestedTools) || !unique(value.requestedCapabilities)
    || !unique(value.resources.map((entry) => entry.id))
    || !unique(value.dependencies.map((entry) => entry.skillId))) {
    context.addIssue({ code: "custom", message: "Skill manifest contains duplicate identities" });
  }
  if (value.dependencies.some((entry) => entry.skillId === value.skillId)) {
    context.addIssue({ code: "custom", message: "Skill cannot depend on itself" });
  }
});

export type SkillManifest = z.infer<typeof skillManifestSchema>;

export function validateSkillManifest(value: unknown, skillId: string, semanticVersion: string): SkillManifest {
  const manifest = skillManifestSchema.parse(value);
  if (manifest.skillId !== skillId || manifest.semanticVersion !== semanticVersion) {
    throw new Error("Skill manifest identity differs from Revision");
  }
  return manifest;
}
