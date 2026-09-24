import { createHash } from "node:crypto";

import type { DatabaseWork } from "@/database";

import { validateSkillManifest } from "./manifest";

export const SKILL_ROUTING_SCHEMA_VERSION = "toonflow.skill-routing.v1" as const;
const IDENTIFIER = /^[A-Za-z0-9._:@-]{1,128}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export interface SkillRoutingDecision {
  schemaVersion: typeof SKILL_ROUTING_SCHEMA_VERSION;
  status: "selected" | "needs-attention" | "unavailable";
  selected: { skillId: string; revisionId: string } | null;
  candidates: Array<{ skillId: string; revisionId: string; priority: number;
    keywordMatches: number; eligible: boolean; reason: "eligible" | "role" | "intent" }>;
}

/** Explicit typed eligibility precedes stable ranking; equal top matches never gain authority by guessing. */
export function createSkillRouter(work: DatabaseWork) {
  return {
    async route(input: { role: string; intent: string; query: string }): Promise<SkillRoutingDecision> {
      if (!IDENTIFIER.test(input.role) || !IDENTIFIER.test(input.intent)
        || typeof input.query !== "string" || input.query.length > 10_000) {
        throw new TypeError("Skill routing request is invalid");
      }
      return work(async (db) => {
        const rows = await db("o_agentSkillBinding as binding")
          .join("o_agentSkillRevision as revision", "revision.id", "binding.activeRevisionId")
          .where({ "revision.status": "published" })
          .orderBy("binding.skillId", "asc")
          .select("binding.skillId", "revision.id as revisionId", "revision.semanticVersion",
            "revision.content", "revision.contentHash", "revision.manifestJson", "revision.manifestHash");
        const normalizedQuery = input.query.toLocaleLowerCase("en");
        const candidates: SkillRoutingDecision["candidates"] = [];
        for (const row of rows) {
          if (hash(row.content) !== row.contentHash
            || hash(row.manifestJson) !== row.manifestHash) {
            throw new Error("Skill routing candidate evidence is corrupt");
          }
          const manifest = validateSkillManifest(JSON.parse(row.manifestJson),
            row.skillId, row.semanticVersion);
          const reason = !manifest.compatibleRoles.includes(input.role) ? "role"
            : !manifest.intents.includes(input.intent) ? "intent" : "eligible";
          candidates.push({ skillId: row.skillId, revisionId: row.revisionId,
            priority: manifest.routing.priority,
            keywordMatches: manifest.routing.keywords.filter((keyword) =>
              normalizedQuery.includes(keyword.toLocaleLowerCase("en"))).length,
            eligible: reason === "eligible", reason });
        }
        const eligible = candidates.filter((candidate) => candidate.eligible)
          .sort((a, b) => b.priority - a.priority || b.keywordMatches - a.keywordMatches
            || a.skillId.localeCompare(b.skillId, "en"));
        if (eligible.length === 0) {
          return { schemaVersion: SKILL_ROUTING_SCHEMA_VERSION, status: "unavailable" as const,
            selected: null, candidates };
        }
        const first = eligible[0];
        const tied = eligible.length > 1 && eligible[1].priority === first.priority
          && eligible[1].keywordMatches === first.keywordMatches;
        return { schemaVersion: SKILL_ROUTING_SCHEMA_VERSION,
          status: tied ? "needs-attention" as const : "selected" as const,
          selected: tied ? null : { skillId: first.skillId, revisionId: first.revisionId },
          candidates };
      });
    },
  };
}
