import { createHash } from "node:crypto";

import type { Knex } from "knex";

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
    keywordMatches: number; eligible: boolean;
    reason: "eligible" | "role" | "intent" | "deprecated" | "revoked" }>;
}

interface RouteInput { role: string; intent: string; query: string }

function validateRouteInput(input: RouteInput): void {
  if (!IDENTIFIER.test(input.role) || !IDENTIFIER.test(input.intent)
    || typeof input.query !== "string" || input.query.length > 10_000) {
    throw new TypeError("Skill routing request is invalid");
  }
}

export async function routeSkillsInTransaction(
  db: Knex | Knex.Transaction, input: RouteInput,
): Promise<SkillRoutingDecision> {
  validateRouteInput(input);
  const rows = await db("o_agentSkillBinding as binding")
    .join("o_agentSkillRevision as revision", "revision.id", "binding.activeRevisionId")
    .join("o_agentSkillRevisionPolicy as policy", "policy.revisionId", "revision.id")
    .where({ "revision.status": "published" })
    .orderBy("binding.skillId", "asc")
    .select("binding.skillId", "revision.id as revisionId", "revision.semanticVersion",
      "revision.content", "revision.contentHash", "revision.manifestJson",
      "revision.manifestHash", "policy.state as policyState");
  const normalizedQuery = input.query.toLocaleLowerCase("en");
  const candidates: SkillRoutingDecision["candidates"] = [];
  for (const row of rows) {
    if (hash(row.content) !== row.contentHash || hash(row.manifestJson) !== row.manifestHash) {
      throw new Error("Skill routing candidate evidence is corrupt");
    }
    const manifest = validateSkillManifest(JSON.parse(row.manifestJson),
      row.skillId, row.semanticVersion);
    const reason = row.policyState === "revoked" ? "revoked"
      : row.policyState === "deprecated" ? "deprecated"
      : !manifest.compatibleRoles.includes(input.role) ? "role"
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
    return { schemaVersion: SKILL_ROUTING_SCHEMA_VERSION, status: "unavailable", selected: null, candidates };
  }
  const first = eligible[0];
  const tied = eligible.length > 1 && eligible[1].priority === first.priority
    && eligible[1].keywordMatches === first.keywordMatches;
  return { schemaVersion: SKILL_ROUTING_SCHEMA_VERSION,
    status: tied ? "needs-attention" : "selected",
    selected: tied ? null : { skillId: first.skillId, revisionId: first.revisionId }, candidates };
}

/** Explicit eligibility precedes stable ranking; equal top matches never gain authority by guessing. */
export function createSkillRouter(work: DatabaseWork, evidence?: { now(): number; createId(): string }) {
  return {
    async route(input: RouteInput): Promise<SkillRoutingDecision> {
      validateRouteInput(input);
      return work((db) => routeSkillsInTransaction(db, input));
    },
    async routeForRun(input: { runId: string; projectId: number; intent: string; query: string }) {
      if (!evidence || !IDENTIFIER.test(input.runId) || !Number.isSafeInteger(input.projectId)
        || input.projectId <= 0) throw new TypeError("Skill Run routing evidence is invalid");
      const id = evidence.createId();
      const createdAt = evidence.now();
      if (!IDENTIFIER.test(id) || !Number.isSafeInteger(createdAt) || createdAt < 0) {
        throw new TypeError("Skill Run routing evidence identity is invalid");
      }
      return work((db) => db.transaction(async (tx) => {
        const run = await tx("o_agentRun").where({ id: input.runId, projectId: input.projectId,
          status: "queued" }).first("role");
        if (!run) throw new Error("Skill routing requires a queued Run in Project scope");
        const routeInput = { role: run.role, intent: input.intent, query: input.query };
        validateRouteInput(routeInput);
        const decision = await routeSkillsInTransaction(tx, routeInput);
        const decisionJson = JSON.stringify(decision);
        await tx("o_agentSkillRouteDecision").insert({ id, runId: input.runId,
          projectId: input.projectId, schemaVersion: SKILL_ROUTING_SCHEMA_VERSION,
          intent: input.intent, queryHash: hash(input.query), decisionJson,
          decisionHash: hash(decisionJson), createdAt });
        return { id, decision };
      }));
    },
  };
}
