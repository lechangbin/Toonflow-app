import { createHash } from "node:crypto";

import type { DatabaseWork } from "@/database";
import { inspectPersistableText } from "@/diagnostics/traceSafeDiagnostics";
import { validateSkillManifest } from "@/skillRuntime/manifest";
import { SKILL_RESOLUTION_SCHEMA_VERSION, type SkillResolutionPlan } from "@/skillRuntime/resolution";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const IDENTIFIER = /^[A-Za-z0-9._:@-]{1,128}$/;

export interface FrozenSkillContextSource {
  skillId: string;
  revisionId: string;
  contentHash: string;
  manifestHash: string;
  content: string;
}

/** Skill instructions are trusted only through the Run's immutable dependency plan and bindings. */
export function createBoundSkillContextSourceLoader(work: DatabaseWork) {
  return {
    async load(input: { runId: string; projectId: number; role: string }): Promise<FrozenSkillContextSource[]> {
      if (!IDENTIFIER.test(input.runId) || !IDENTIFIER.test(input.role)
        || !Number.isSafeInteger(input.projectId) || input.projectId <= 0) {
        throw new TypeError("Bound Skill Context request is invalid");
      }
      return work(async (db) => {
        const run = await db("o_agentRun").where({ id: input.runId,
          projectId: input.projectId, role: input.role }).first("id");
        if (!run) throw new Error("Bound Skill Context Run is outside Project scope");
        const resolution = await db("o_agentRunSkillResolution")
          .where({ runId: input.runId }).first();
        if (!resolution || resolution.schemaVersion !== SKILL_RESOLUTION_SCHEMA_VERSION
          || hash(resolution.planJson) !== resolution.planHash) {
          throw new Error("Bound Skill Context resolution evidence is missing or corrupt");
        }
        let plan: SkillResolutionPlan;
        try { plan = JSON.parse(resolution.planJson) as SkillResolutionPlan; }
        catch { throw new Error("Bound Skill Context resolution evidence is corrupt"); }
        if (plan.schemaVersion !== SKILL_RESOLUTION_SCHEMA_VERSION
          || !Array.isArray(plan.revisions) || plan.revisions.length === 0
          || !Array.isArray(plan.dependencies) || !Array.isArray(plan.roots)) {
          throw new Error("Bound Skill Context resolution evidence is corrupt");
        }
        const bindings = await db("o_agentRunSkillBinding").where({ runId: input.runId });
        if (bindings.length !== plan.revisions.length) {
          throw new Error("Bound Skill Context binding set differs from frozen resolution");
        }
        const bySkill = new Map(bindings.map((entry) => [entry.skillId, entry]));
        const sources: FrozenSkillContextSource[] = [];
        for (const entry of plan.revisions) {
          const binding = bySkill.get(entry.skillId);
          if (!binding || binding.revisionId !== entry.revisionId
            || binding.contentHash !== entry.contentHash
            || binding.manifestHash !== entry.manifestHash) {
            throw new Error("Bound Skill Context binding differs from frozen resolution");
          }
          const revision = await db("o_agentSkillRevision").where({ id: entry.revisionId,
            skillId: entry.skillId, status: "published" }).first();
          const policy = await db("o_agentSkillRevisionPolicy")
            .where({ revisionId: entry.revisionId }).first("state");
          if (!revision || !policy || policy.state === "revoked"
            || revision.contentHash !== entry.contentHash
            || revision.manifestHash !== entry.manifestHash
            || hash(revision.content) !== entry.contentHash
            || hash(revision.manifestJson) !== entry.manifestHash
            || !inspectPersistableText(revision.content).ok) {
            throw new Error("Bound Skill Context Revision is revoked or corrupt");
          }
          const manifest = validateSkillManifest(JSON.parse(revision.manifestJson),
            entry.skillId, revision.semanticVersion);
          if (!manifest.compatibleRoles.includes(input.role)) {
            throw new Error("Bound Skill Context role is incompatible with Revision");
          }
          sources.push({ skillId: entry.skillId, revisionId: entry.revisionId,
            contentHash: entry.contentHash, manifestHash: entry.manifestHash,
            content: revision.content });
        }
        return sources;
      });
    },
  };
}
