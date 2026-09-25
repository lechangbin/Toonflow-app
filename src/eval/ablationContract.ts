import { createHash } from "node:crypto";

import { z } from "zod";

export const ABLATION_MANIFEST_VERSION = "toonflow.ablation-manifest.v1" as const;

/** Four leave-one-out Context candidates compared with one full-control reference. */
export const CONTEXT_ABLATION_VARIANTS = [
  "without-retrieval", "without-memory", "without-compaction",
  "without-provenance",
] as const;

/** Routing alternatives retain the same hard permission gates. */
export const SKILL_ABLATION_VARIANTS = [
  "explicit-route", "keyword-route", "dependency-route",
  "ranked-route",
] as const;

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.string().trim().min(1).max(128);
const caseId = z.string().regex(/^(DEV|HOLD|INC)-[A-Z]+-\d{3}$/u);
const positiveInt = z.number().int().positive();

export const ablationManifestSchema = z.strictObject({
  schemaVersion: z.literal(ABLATION_MANIFEST_VERSION),
  studyId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/u),
  axis: z.enum(["context", "skill"]),
  /** A full-control run is required for leave-one-out comparison. */
  referenceVariant: z.string().min(1),
  candidateVariants: z.array(z.string().min(1)).length(4),
  caseManifestHash: digest,
  caseIds: z.array(caseId).min(1),
  seeds: z.array(z.number().int().nonnegative()).min(2),
  revisions: z.strictObject({
    app: revision, runtime: revision, tool: revision,
    context: revision, memory: revision, skill: revision,
    model: revision, vendor: revision, cases: revision,
  }),
  commonBudget: z.strictObject({
    maxInputTokens: positiveInt, maxOutputTokens: positiveInt,
    maxToolCalls: positiveInt, timeoutMs: positiveInt,
  }),
  /** Fixed before any candidate result is inspected; no composite score. */
  thresholds: z.strictObject({
    minQualityScore: z.number().int().min(0).max(2),
    maxP95LatencyMs: positiveInt,
    maxCostMicrosPerCase: z.number().int().nonnegative(),
    maxRetriesPerCase: z.number().int().nonnegative(),
    zeroToleranceGateIds: z.tuple([
      z.literal("leakage"), z.literal("holdout-contamination"),
      z.literal("redaction-failure"), z.literal("permission-escalation"),
    ]),
  }),
  frozenAt: z.number().int().nonnegative(),
});

export type AblationManifest = z.infer<typeof ablationManifestSchema>;

export function validateAblationManifest(input: unknown): AblationManifest {
  const parsed = ablationManifestSchema.parse(input);
  const expected = parsed.axis === "context"
    ? CONTEXT_ABLATION_VARIANTS : SKILL_ABLATION_VARIANTS;
  if (parsed.referenceVariant !== (parsed.axis === "context"
    ? "full-context" : "permission-gated-route")
    || parsed.candidateVariants.length !== expected.length
    || parsed.candidateVariants.some((value, index) => value !== expected[index])
    || new Set(parsed.caseIds).size !== parsed.caseIds.length
    || new Set(parsed.seeds).size !== parsed.seeds.length
    || parsed.seeds.some((value, index) => index > 0 && value <= parsed.seeds[index - 1])) {
    throw new TypeError("Ablation variants, cases or repeated seeds are not frozen canonically");
  }
  return parsed;
}

export function hashAblationManifest(input: unknown): string {
  const manifest = validateAblationManifest(input);
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

export function expectedAblationRunKeys(manifest: AblationManifest): string[] {
  const validated = validateAblationManifest(manifest);
  return [validated.referenceVariant, ...validated.candidateVariants]
    .flatMap((variant) => validated.caseIds.flatMap((id) =>
      validated.seeds.map((seed) => `${variant}:${id}:${seed}`)));
}

const failureClass = z.enum(["none", "routing", "dependency", "permission",
  "context", "vendor", "timeout", "quality", "evidence"]);
export const ablationRunResultSchema = z.strictObject({
  manifestHash: digest,
  executedAt: z.number().int().nonnegative(),
  variant: z.string().min(1), caseId, seed: z.number().int().nonnegative(),
  qualityScore: z.number().int().min(0).max(2).nullable(),
  qualityEvidenceIds: z.array(z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u)),
  latencyMs: z.number().int().nonnegative(),
  costMicros: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  failureClass,
  hardGates: z.strictObject({ leakage: z.boolean(),
    "holdout-contamination": z.boolean(),
    "redaction-failure": z.boolean(),
    "permission-escalation": z.boolean() }),
});
export type AblationRunResult = z.infer<typeof ablationRunResultSchema>;

export interface AblationVariantSummary {
  variant: string;
  expected: number; executed: number; missing: number;
  qualityPending: number; qualityBelowThreshold: number;
  p95LatencyMs: number | null; latencyThresholdPassed: boolean;
  costOverLimit: number; retriesOverLimit: number;
  budgetExceeded: number; hardGateFailures: Record<string, number>;
  failureClasses: Record<string, number>;
  /** No composite score: every predeclared threshold must independently pass. */
  adoptable: boolean;
}

export function summarizeAblationResults(manifestInput: unknown,
  resultInputs: readonly unknown[]): { manifestHash: string; expected: number;
    executed: number; missing: number; variants: AblationVariantSummary[] } {
  const manifest = validateAblationManifest(manifestInput);
  const manifestHash = hashAblationManifest(manifest);
  const expectedKeys = new Set(expectedAblationRunKeys(manifest));
  const seen = new Set<string>();
  const results = resultInputs.map((input) => {
    const result = ablationRunResultSchema.parse(input);
    const key = `${result.variant}:${result.caseId}:${result.seed}`;
    if (result.manifestHash !== manifestHash
      || result.executedAt < manifest.frozenAt || !expectedKeys.has(key)
      || seen.has(key)) throw new TypeError("Ablation result is duplicate, unexpected or not bound to manifest");
    if (result.qualityScore !== null && result.qualityEvidenceIds.length === 0) {
      throw new TypeError("Reviewed Ablation quality score needs evidence IDs");
    }
    seen.add(key);
    return result;
  });
  const expectedPerVariant = manifest.caseIds.length * manifest.seeds.length;
  const variants = [manifest.referenceVariant, ...manifest.candidateVariants].map((variant) => {
    const rows = results.filter((entry) => entry.variant === variant);
    const latency = rows.map((entry) => entry.latencyMs).sort((a, b) => a - b);
    const p95LatencyMs = latency.length
      ? latency[Math.ceil(latency.length * 0.95) - 1] : null;
    const hardGateFailures = Object.fromEntries(manifest.thresholds.zeroToleranceGateIds
      .map((gate) => [gate, rows.filter((entry) => !entry.hardGates[gate]).length]));
    const failureClasses = Object.fromEntries(failureClass.options
      .map((kind) => [kind, rows.filter((entry) => entry.failureClass === kind).length]));
    const qualityPending = rows.filter((entry) => entry.qualityScore === null).length;
    const qualityBelowThreshold = rows.filter((entry) => entry.qualityScore !== null
      && entry.qualityScore < manifest.thresholds.minQualityScore).length;
    const costOverLimit = rows.filter((entry) =>
      entry.costMicros > manifest.thresholds.maxCostMicrosPerCase).length;
    const retriesOverLimit = rows.filter((entry) =>
      entry.retries > manifest.thresholds.maxRetriesPerCase).length;
    const budgetExceeded = rows.filter((entry) =>
      entry.inputTokens > manifest.commonBudget.maxInputTokens
      || entry.outputTokens > manifest.commonBudget.maxOutputTokens
      || entry.toolCalls > manifest.commonBudget.maxToolCalls
      || entry.latencyMs > manifest.commonBudget.timeoutMs).length;
    const missing = expectedPerVariant - rows.length;
    const latencyThresholdPassed = p95LatencyMs !== null
      && p95LatencyMs <= manifest.thresholds.maxP95LatencyMs;
    return { variant, expected: expectedPerVariant, executed: rows.length,
      missing, qualityPending, qualityBelowThreshold,
      p95LatencyMs, latencyThresholdPassed, costOverLimit, retriesOverLimit,
      budgetExceeded, hardGateFailures, failureClasses,
      adoptable: missing === 0 && qualityPending === 0 && qualityBelowThreshold === 0
        && latencyThresholdPassed && costOverLimit === 0 && retriesOverLimit === 0
        && budgetExceeded === 0 && Object.values(hardGateFailures).every((count) => count === 0),
    };
  });
  return { manifestHash, expected: expectedKeys.size, executed: results.length,
    missing: expectedKeys.size - results.length, variants };
}
