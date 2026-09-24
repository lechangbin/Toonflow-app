import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import getPath from "@/utils/getPath";

import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from "./manifest";

/** Explicit, reviewed legacy source. This is reference prose, not an executable Agent flow. */
export const LEGACY_SKILL_IMPORTS = Object.freeze({
  coming_of_age_director_planning: Object.freeze({
    parts: ["skills", "story_skills", "Coming_of_age", "driector_skills",
      "director_planning_narrative.md"],
    normalizedSourceHash: "26e3152141fcf910acc2033d087e6a96f9495734c6d8858ac022dd9b84080fb3",
    name: "director_planning_narrative",
    role: "productionAgent",
  }),
});

export type LegacySkillImportId = keyof typeof LEGACY_SKILL_IMPORTS;

/** Returns an authoring proposal only; caller must save, publish and activate separately. */
export function adaptLegacySkill(input: { sourceId: LegacySkillImportId;
  raw: string; skillId: string; semanticVersion: string }) {
  const source = LEGACY_SKILL_IMPORTS[input.sourceId];
  if (!source) throw new TypeError("Legacy Skill source is not allowlisted");
  const normalized = input.raw.replace(/\r\n/g, "\n");
  const sourceHash = createHash("sha256").update(normalized).digest("hex");
  if (sourceHash !== source.normalizedSourceHash) {
    throw new Error("Legacy Skill source changed; review and pin a new adapter revision");
  }
  const match = /^---\nname: ([A-Za-z0-9._-]+)\ndescription: ([^\n]+)\nmetaData: director_skills\n---\n\n([\s\S]+)$/.exec(normalized);
  if (!match || match[1] !== source.name || !match[2].trim() || !match[3].trim()) {
    throw new Error("Legacy Skill format is incompatible with this adapter");
  }
  const content = match[3].trim();
  if (/\b(?:activate_skill|get_planData|run_sub_agent)\b/.test(content)) {
    throw new Error("Legacy Skill requests unsupported runtime Tools");
  }
  const manifest: SkillManifest = {
    schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
    skillId: input.skillId, semanticVersion: input.semanticVersion,
    compatibleRoles: [source.role], intents: ["read-only-guidance"],
    dependencies: [], requestedTools: [], requestedCapabilities: [], resources: [],
    routing: { priority: 0, keywords: [] },
    attribution: `legacy:${input.sourceId}:${sourceHash}`,
  };
  return { sourceId: input.sourceId, sourceHash, content, manifest };
}

export async function previewLegacySkillImport(input: { sourceId: LegacySkillImportId;
  skillId: string; semanticVersion: string }) {
  const source = LEGACY_SKILL_IMPORTS[input.sourceId];
  if (!source) throw new TypeError("Legacy Skill source is not allowlisted");
  const raw = await readFile(getPath(source.parts), "utf8");
  return adaptLegacySkill({ ...input, raw });
}
