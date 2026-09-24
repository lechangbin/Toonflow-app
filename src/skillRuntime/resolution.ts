import { createHash } from "node:crypto";

import type { DatabaseWork } from "@/database";

import { validateSkillManifest } from "./manifest";

const IDENTIFIER = /^[A-Za-z0-9._:@-]{1,128}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export const SKILL_RESOLUTION_SCHEMA_VERSION = "toonflow.skill-resolution.v1" as const;

export interface SkillResolutionPlan {
  schemaVersion: typeof SKILL_RESOLUTION_SCHEMA_VERSION;
  roots: string[];
  revisions: Array<{ skillId: string; revisionId: string; semanticVersion: string;
    contentHash: string; manifestHash: string }>;
  dependencies: Array<{ fromSkillId: string; toSkillId: string; revisionId: string }>;
}

/** Resolves immutable exact dependencies before activation; no manifest grants Tool authority. */
export function createSkillDependencyResolver(work: DatabaseWork) {
  return {
    async resolve(input: { role: string; rootSkillIds: readonly string[] }): Promise<SkillResolutionPlan> {
      if (!IDENTIFIER.test(input.role) || input.rootSkillIds.length === 0
        || input.rootSkillIds.length > 30 || input.rootSkillIds.some((id) => !IDENTIFIER.test(id))
        || new Set(input.rootSkillIds).size !== input.rootSkillIds.length) {
        throw new TypeError("Skill resolution request is invalid");
      }
      return work((db) => db.transaction(async (tx) => {
        const roots = [...input.rootSkillIds].sort((a, b) => a.localeCompare(b, "en"));
        const visiting = new Set<string>();
        const resolved = new Map<string, SkillResolutionPlan["revisions"][number]>();
        const dependencies: SkillResolutionPlan["dependencies"] = [];
        const ordered: SkillResolutionPlan["revisions"] = [];
        const visit = async (skillId: string, exactVersion?: string): Promise<void> => {
          if (visiting.has(skillId)) throw new Error("Skill dependency cycle detected");
          const previous = resolved.get(skillId);
          if (previous) {
            if (exactVersion !== undefined && previous.semanticVersion !== exactVersion) {
              throw new Error("Skill dependency requests incompatible revisions");
            }
            return;
          }
          if (visiting.size >= 16 || resolved.size >= 30) throw new Error("Skill dependency graph exceeds bounds");
          visiting.add(skillId);
          const revision = exactVersion === undefined
            ? await tx("o_agentSkillBinding as binding")
              .join("o_agentSkillRevision as revision", "revision.id", "binding.activeRevisionId")
              .where({ "binding.skillId": skillId, "revision.status": "published" })
              .first("revision.*")
            : await tx("o_agentSkillRevision")
              .where({ skillId, semanticVersion: exactVersion, status: "published" }).first();
          if (!revision || hash(revision.content) !== revision.contentHash
            || hash(revision.manifestJson) !== revision.manifestHash) {
            throw new Error("Skill dependency revision is missing or corrupt");
          }
          const manifest = validateSkillManifest(JSON.parse(revision.manifestJson),
            skillId, revision.semanticVersion);
          if (!manifest.compatibleRoles.includes(input.role)) {
            throw new Error("Skill dependency is incompatible with Agent role");
          }
          for (const dependency of [...manifest.dependencies]
            .sort((a, b) => a.skillId.localeCompare(b.skillId, "en"))) {
            await visit(dependency.skillId, dependency.semanticVersion);
            dependencies.push({ fromSkillId: skillId, toSkillId: dependency.skillId,
              revisionId: resolved.get(dependency.skillId)!.revisionId });
          }
          visiting.delete(skillId);
          const entry = { skillId, revisionId: revision.id,
            semanticVersion: revision.semanticVersion, contentHash: revision.contentHash,
            manifestHash: revision.manifestHash };
          resolved.set(skillId, entry);
          ordered.push(entry);
        };
        for (const root of roots) await visit(root);
        return { schemaVersion: SKILL_RESOLUTION_SCHEMA_VERSION, roots,
          revisions: ordered, dependencies };
      }));
    },
  };
}
