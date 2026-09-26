import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { planContextBudget } from "../src/context/budget";
import { ContextSourceUnavailableError, selectEligibleContextSources,
  type ContextCandidateSource } from "../src/context/sourceSelection";

const digest = (content: string) => createHash("sha256").update(content).digest("hex");
function source(id: string, content: string, change: Partial<ContextCandidateSource> = {}): ContextCandidateSource {
  return { id, projectId: 7, revision: "rev-1", content, contentHash: digest(content),
    category: "authoritative", freshness: "current", authorityRank: 1, relevanceRank: 1, ...change };
}
const request = { projectId: 7, scriptId: 8, role: "scriptAgent", requiredSourceIds: ["project-7"],
  expectedRevisions: { "project-7": "rev-1" } };
const budget = planContextBudget({ contextWindowTokens: 4_000, policyMaxInputTokens: 3_000,
  outputReserveTokens: 500, toolProtocolReserveTokens: 100, mandatoryTokens: 200, risk: "standard",
  optionalDemandTokens: { authoritative: 5_000, toolResults: 0, recentInteraction: 0, memory: 0 } });

test("scope/revision/retention filters run before ranking; selected order and omissions are deterministic", () => {
  const candidates = [source("unrelated", "secret", { projectId: 9, relevanceRank: 0 }),
    source("other-script", "wrong", { scriptId: 10, relevanceRank: 0 }),
    source("stale", "old", { freshness: "stale", relevanceRank: 0 }),
    source("project-7", "facts", { authorityRank: 0 }),
    source("project-7", "facts", { authorityRank: 0 }),
    source("valid", "novel", { scriptId: 8, relevanceRank: 2 })];
  const selected = selectEligibleContextSources(request, candidates, budget);
  assert.deepEqual(selected.selected.map((entry) => entry.id), ["project-7", "valid"]);
  assert.deepEqual(selected.omissions.map((entry) => entry.reason),
    ["wrong-script", "duplicate", "stale", "wrong-project"]);
  assert.deepEqual(selectEligibleContextSources(request, [...candidates].reverse(), budget).selected,
    selected.selected, "eligible ordering is independent of database delivery order");
  assert.deepEqual(selectEligibleContextSources(request, [...candidates].reverse(), budget).omissions,
    selected.omissions, "omission manifest is deterministic");
  assert.deepEqual(selected.selectedContent, ["facts", "novel"]);
  assert.deepEqual(selected.compactionActions,
    [{ sourceId: "project-7", action: "deduplicated" }]);
  assert.equal("content" in selected.selected[0], false, "manifest entry contains provenance, not raw Project text");
});

test("required evidence and corrupt or conflicting source identity fail closed", () => {
  assert.throws(() => selectEligibleContextSources(request, [source("project-7", "facts",
    { revision: "old" })], budget), ContextSourceUnavailableError);
  assert.throws(() => selectEligibleContextSources(request, [source("project-7", "facts",
    { projectId: 9 })], budget), ContextSourceUnavailableError);
  assert.throws(() => selectEligibleContextSources(request, [source("project-7", "facts",
    { contentHash: "0".repeat(64) })], budget), /corrupt/);
  assert.deepEqual(selectEligibleContextSources(request, [source("foreign", "private",
    { projectId: 9, contentHash: "0".repeat(64) }), source("project-7", "facts")], budget)
    .omissions, [{ id: "foreign", reason: "wrong-project" }],
  "unauthorized content must be rejected by scope before its hash is inspected");
  assert.throws(() => selectEligibleContextSources(request, [source("project-7", "facts"),
    source("project-7", "different")], budget), /conflicting content/);
  assert.throws(() => selectEligibleContextSources({ ...request, expectedRevisions: {} }, [source("project-7", "facts"),
    source("project-7", "facts", { revision: "rev-2" })], budget), /conflicting content or revision/);
});

test("allocation overflow omits optional text and never truncates required evidence", () => {
  const narrow = planContextBudget({ contextWindowTokens: 2_000, policyMaxInputTokens: 900,
    outputReserveTokens: 300, toolProtocolReserveTokens: 100, mandatoryTokens: 100, risk: "standard",
    optionalDemandTokens: { authoritative: 1_000, toolResults: 0, recentInteraction: 0, memory: 0 } });
  const large = source("large", "a".repeat(900), { authorityRank: 0 });
  const selected = selectEligibleContextSources(request, [large, source("project-7", "facts")], narrow);
  assert.deepEqual(selected.selected.map((entry) => entry.id), ["project-7"]);
  assert.deepEqual(selected.omissions, [{ id: "large", reason: "allocation-exceeded" }]);
  assert.deepEqual(selected.compactionActions, [{ sourceId: "large", action: "omitted-over-budget" }]);
  assert.throws(() => selectEligibleContextSources({ ...request, requiredSourceIds: ["large"] }, [large], narrow),
    ContextSourceUnavailableError);
});

test("same source identity with a different evidence locator fails closed", () => {
  const first = source("project-7", "same text", { transform: { kind: "locatable-evidence-slice.v1",
    startCodePoint: 0, endCodePoint: 1, sourceTextHash: "a".repeat(64) } });
  const second = source("project-7", "same text", { transform: { kind: "locatable-evidence-slice.v1",
    startCodePoint: 3, endCodePoint: 4, sourceTextHash: "a".repeat(64) } });
  assert.throws(() => selectEligibleContextSources(request, [first, second], budget), /conflicting.*locator/);
});

test("optional Tool evidence uses a hashed partial projection only when the full result cannot fit", () => {
  const full = "source data ".repeat(80);
  const compact = "Partial committed ToolResult get_novel_text: short excerpt";
  const candidate = source("tool:receipt-1", full, { category: "toolResults", compact: {
    content: compact, contentHash: digest(compact), transform: { kind: "tool-result-projection.v1",
      sourceContentHash: digest(full), strategy: "novel-text-prefix-128" },
  } });
  const narrow = planContextBudget({ contextWindowTokens: 2_000, policyMaxInputTokens: 700,
    outputReserveTokens: 200, toolProtocolReserveTokens: 100, mandatoryTokens: 100, risk: "standard",
    optionalDemandTokens: { authoritative: 0, toolResults: full.length, recentInteraction: 0, memory: 0 } });
  const selected = selectEligibleContextSources({ ...request, requiredSourceIds: [] }, [candidate], narrow);
  assert.deepEqual(selected.selectedContent, [compact]);
  assert.deepEqual(selected.compactionActions, [{ sourceId: candidate.id, action: "tool-projection" }]);
  assert.equal(selected.selected[0].contentHash, digest(compact));
  assert.deepEqual(selected.selected[0].transform, candidate.compact?.transform);
  assert.throws(() => selectEligibleContextSources({ ...request, requiredSourceIds: [candidate.id] },
    [candidate], narrow), ContextSourceUnavailableError, "required evidence is never silently reduced");
  assert.throws(() => selectEligibleContextSources({ ...request, requiredSourceIds: [] },
    [{ ...candidate, compact: { ...candidate.compact!, contentHash: digest("wrong") } }], narrow), /corrupt/);
  const roomy = planContextBudget({ contextWindowTokens: 4_000, policyMaxInputTokens: 3_000,
    outputReserveTokens: 200, toolProtocolReserveTokens: 100, mandatoryTokens: 100, risk: "standard",
    optionalDemandTokens: { authoritative: 0, toolResults: full.length, recentInteraction: 0, memory: 0 } });
  assert.deepEqual(selectEligibleContextSources({ ...request, requiredSourceIds: [] },
    [candidate], roomy).selectedContent, [full]);
});
