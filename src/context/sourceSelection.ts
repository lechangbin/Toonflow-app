import { createHash } from "node:crypto";

import { estimateContextTokens, type ContextBudgetPlan, type ContextCategory } from "./budget";

export const CONTEXT_SOURCE_SELECTION_VERSION = "toonflow.context-source-selection.v1" as const;

export interface ContextCandidateSource {
  id: string;
  projectId: number;
  scriptId?: number;
  role?: string;
  revision: string;
  content: string;
  contentHash: string;
  category: ContextCategory;
  freshness: "current" | "historical" | "stale" | "expired";
  authorityRank: number;
  relevanceRank: number;
}

export interface ContextSourceRequest {
  projectId: number;
  scriptId?: number;
  role: string;
  requiredSourceIds: readonly string[];
  expectedRevisions: Readonly<Record<string, string>>;
}

export type ContextOmissionReason = "wrong-project" | "wrong-script" | "wrong-role"
  | "revision-mismatch" | "stale" | "expired" | "duplicate" | "allocation-exceeded";

export interface ContextSourceEntry {
  id: string;
  revision: string;
  contentHash: string;
  category: ContextCategory;
  freshness: "current" | "historical";
  estimatedTokens: number;
  authorityRank: number;
}

export interface ContextSourceSelection {
  schemaVersion: typeof CONTEXT_SOURCE_SELECTION_VERSION;
  selected: ContextSourceEntry[];
  omissions: Array<{ id: string; reason: ContextOmissionReason }>;
  selectedContent: string[];
}

export class ContextSourceUnavailableError extends Error {
  readonly code = "context_source_unavailable";
  constructor(readonly sourceId: string) {
    super(`Required Context source is unavailable: ${sourceId}`);
    this.name = "ContextSourceUnavailableError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9._:@-]{1,128}$/;

/** Filters eligibility before relevance ordering. Input records must come from an authorized source loader. */
export function selectEligibleContextSources(
  request: ContextSourceRequest, candidates: readonly ContextCandidateSource[], budget: ContextBudgetPlan,
): ContextSourceSelection {
  if (!Number.isSafeInteger(request.projectId) || request.projectId <= 0 || !request.role
    || (request.scriptId !== undefined && (!Number.isSafeInteger(request.scriptId) || request.scriptId <= 0))
    || request.requiredSourceIds.some((id) => !IDENTIFIER.test(id))) {
    throw new TypeError("Context source request is invalid");
  }
  const omissions: ContextSourceSelection["omissions"] = [];
  const eligible: ContextCandidateSource[] = [];
  const seen = new Map<string, string>();
  for (const source of candidates) {
    if (!IDENTIFIER.test(source.id) || !IDENTIFIER.test(source.revision)
      || !HASH.test(source.contentHash)
      || createHash("sha256").update(source.content).digest("hex") !== source.contentHash
      || !Number.isSafeInteger(source.authorityRank) || source.authorityRank < 0
      || !Number.isSafeInteger(source.relevanceRank) || source.relevanceRank < 0
      || !["authoritative", "toolResults", "recentInteraction", "memory"].includes(source.category)
      || !["current", "historical", "stale", "expired"].includes(source.freshness)) {
      throw new Error("Context source evidence is corrupt");
    }
    let reason: ContextOmissionReason | undefined;
    if (source.projectId !== request.projectId) reason = "wrong-project";
    else if (source.scriptId !== undefined && source.scriptId !== request.scriptId) reason = "wrong-script";
    else if (source.role !== undefined && source.role !== request.role) reason = "wrong-role";
    else if (request.expectedRevisions[source.id] !== undefined
      && source.revision !== request.expectedRevisions[source.id]) reason = "revision-mismatch";
    else if (source.freshness === "stale") reason = "stale";
    else if (source.freshness === "expired") reason = "expired";
    if (reason) { omissions.push({ id: source.id, reason }); continue; }
    const previousHash = seen.get(source.id);
    if (previousHash !== undefined) {
      if (previousHash !== source.contentHash) throw new Error("Context source identity has conflicting content");
      omissions.push({ id: source.id, reason: "duplicate" });
      continue;
    }
    seen.set(source.id, source.contentHash);
    eligible.push(source);
  }
  for (const id of request.requiredSourceIds) {
    if (!seen.has(id)) throw new ContextSourceUnavailableError(id);
  }
  eligible.sort((a, b) => a.authorityRank - b.authorityRank
    || a.relevanceRank - b.relevanceRank || a.id.localeCompare(b.id, "en"));
  const remaining = { ...budget.allowedTokens };
  const selected: ContextSourceEntry[] = [];
  const selectedContent: string[] = [];
  for (const source of eligible) {
    const estimatedTokens = estimateContextTokens(source.content);
    if (estimatedTokens > remaining[source.category]) {
      if (request.requiredSourceIds.includes(source.id)) throw new ContextSourceUnavailableError(source.id);
      omissions.push({ id: source.id, reason: "allocation-exceeded" });
      continue;
    }
    remaining[source.category] -= estimatedTokens;
    selected.push({ id: source.id, revision: source.revision, contentHash: source.contentHash,
      category: source.category, freshness: source.freshness as "current" | "historical", estimatedTokens,
      authorityRank: source.authorityRank });
    selectedContent.push(source.content);
  }
  return { schemaVersion: CONTEXT_SOURCE_SELECTION_VERSION, selected, omissions, selectedContent };
}
