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
  transform?: { kind: "locatable-evidence-slice.v1"; startCodePoint: number;
    endCodePoint: number; sourceTextHash: string };
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
  transform?: ContextCandidateSource["transform"];
}

export interface ContextSourceSelection {
  schemaVersion: typeof CONTEXT_SOURCE_SELECTION_VERSION;
  selected: ContextSourceEntry[];
  omissions: Array<{ id: string; reason: ContextOmissionReason }>;
  compactionActions: Array<{ sourceId: string; action:
    "typed-projection" | "evidence-slice" | "deduplicated" | "omitted-over-budget" }>;
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
  const compactionActions: ContextSourceSelection["compactionActions"] = [];
  const eligible: ContextCandidateSource[] = [];
  const seen = new Map<string, { revision: string; contentHash: string; transform?: string }>();
  for (const source of candidates) {
    if (!IDENTIFIER.test(source.id)) throw new Error("Context source identity is corrupt");
    let reason: ContextOmissionReason | undefined;
    if (source.projectId !== request.projectId) reason = "wrong-project";
    else if (source.scriptId !== undefined && source.scriptId !== request.scriptId) reason = "wrong-script";
    else if (source.role !== undefined && source.role !== request.role) reason = "wrong-role";
    else if (request.expectedRevisions[source.id] !== undefined
      && source.revision !== request.expectedRevisions[source.id]) reason = "revision-mismatch";
    else if (source.freshness === "stale") reason = "stale";
    else if (source.freshness === "expired") reason = "expired";
    if (reason) { omissions.push({ id: source.id, reason }); continue; }
    if (!IDENTIFIER.test(source.revision) || !HASH.test(source.contentHash)
      || createHash("sha256").update(source.content).digest("hex") !== source.contentHash
      || !Number.isSafeInteger(source.authorityRank) || source.authorityRank < 0
      || !Number.isSafeInteger(source.relevanceRank) || source.relevanceRank < 0
      || !["authoritative", "toolResults", "recentInteraction", "memory"].includes(source.category)
      || !["current", "historical"].includes(source.freshness)
      || (source.transform !== undefined && (source.transform.kind !== "locatable-evidence-slice.v1"
        || !Number.isSafeInteger(source.transform.startCodePoint) || source.transform.startCodePoint < 0
        || !Number.isSafeInteger(source.transform.endCodePoint)
        || source.transform.endCodePoint <= source.transform.startCodePoint
        || !HASH.test(source.transform.sourceTextHash)))) {
      throw new Error("Context source evidence is corrupt");
    }
    const previous = seen.get(source.id);
    if (previous !== undefined) {
      if (previous.contentHash !== source.contentHash || previous.revision !== source.revision
        || previous.transform !== JSON.stringify(source.transform)) {
        throw new Error("Context source identity has conflicting content or revision or locator");
      }
      omissions.push({ id: source.id, reason: "duplicate" });
      compactionActions.push({ sourceId: source.id, action: "deduplicated" });
      continue;
    }
    seen.set(source.id, { revision: source.revision, contentHash: source.contentHash,
      transform: JSON.stringify(source.transform) });
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
      compactionActions.push({ sourceId: source.id, action: "omitted-over-budget" });
      continue;
    }
    remaining[source.category] -= estimatedTokens;
    selected.push({ id: source.id, revision: source.revision, contentHash: source.contentHash,
      category: source.category, freshness: source.freshness as "current" | "historical", estimatedTokens,
      authorityRank: source.authorityRank,
      ...(source.transform ? { transform: source.transform } : {}) });
    selectedContent.push(source.content);
    if (source.id.startsWith("project:")) {
      compactionActions.push({ sourceId: source.id, action: "typed-projection" });
    }
    if (source.transform?.kind === "locatable-evidence-slice.v1") {
      compactionActions.push({ sourceId: source.id, action: "evidence-slice" });
    }
  }
  omissions.sort((a, b) => a.id.localeCompare(b.id, "en") || a.reason.localeCompare(b.reason, "en"));
  compactionActions.sort((a, b) => a.sourceId.localeCompare(b.sourceId, "en")
    || a.action.localeCompare(b.action, "en"));
  return { schemaVersion: CONTEXT_SOURCE_SELECTION_VERSION, selected, omissions,
    compactionActions, selectedContent };
}
