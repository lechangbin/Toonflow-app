import { ablationRunResultSchema, hashAblationManifest,
  summarizeAblationResults, validateAblationManifest,
  type AblationManifest, type AblationRunResult } from "./ablationContract";

const adapterMetricsSchema = ablationRunResultSchema.omit({
  manifestHash: true, executedAt: true, variant: true,
  caseId: true, seed: true,
});
export type AblationAdapterMetrics = ReturnType<typeof adapterMetricsSchema.parse>;

export interface AblationInvocation {
  manifestHash: string; axis: AblationManifest["axis"];
  variant: string; caseId: string; seed: number;
  commonBudget: AblationManifest["commonBudget"];
  revisions: AblationManifest["revisions"];
}

/** Deterministic matrix driver; an adapter must implement the real variant effects. */
export async function runAblationMatrix(input: {
  manifest: unknown;
  now(): number;
  execute(invocation: AblationInvocation): Promise<unknown>;
}): Promise<{ manifestHash: string; results: AblationRunResult[];
  summary: ReturnType<typeof summarizeAblationResults> }> {
  const manifest = validateAblationManifest(input.manifest);
  const manifestHash = hashAblationManifest(manifest);
  if (input.now() < manifest.frozenAt) {
    throw new TypeError("Ablation cannot run before its manifest is frozen");
  }
  const results: AblationRunResult[] = [];
  for (const variant of [manifest.referenceVariant, ...manifest.candidateVariants]) {
    for (const caseId of manifest.caseIds) {
      for (const seed of manifest.seeds) {
        const invocation: AblationInvocation = { manifestHash,
          axis: manifest.axis, variant, caseId, seed,
          commonBudget: { ...manifest.commonBudget },
          revisions: { ...manifest.revisions } };
        let metrics: AblationAdapterMetrics;
        try {
          metrics = adapterMetricsSchema.parse(await input.execute(invocation));
        } catch {
          // Never persist an adapter exception: it can contain a raw prompt or secret.
          metrics = { qualityScore: null, qualityEvidenceIds: [],
            latencyMs: 0, costMicros: 0, inputTokens: 0,
            outputTokens: 0, toolCalls: 0, retries: 0,
            failureClass: "evidence", hardGates: { leakage: false,
              "holdout-contamination": false, "redaction-failure": false,
              "permission-escalation": false } };
        }
        const result = ablationRunResultSchema.parse({ ...metrics,
          manifestHash, executedAt: input.now(), variant, caseId, seed });
        results.push(result);
      }
    }
  }
  return { manifestHash, results,
    summary: summarizeAblationResults(manifest, results) };
}
