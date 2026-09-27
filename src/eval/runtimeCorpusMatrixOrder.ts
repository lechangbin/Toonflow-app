import { RUNTIME_CORPUS_EVALUATION_RUN_VERSION,
  validateEvaluationRunManifest, type EvaluationRunManifest } from "./evaluationRun";

/** Fixed 36-pair, 72-side order; alternating which treatment executes first. */
export function planRuntimeCorpusMatrixOrder(input: EvaluationRunManifest,
  recordedCellIds: readonly string[] = []) {
  const manifest = validateEvaluationRunManifest(input);
  if (manifest.schemaVersion !== RUNTIME_CORPUS_EVALUATION_RUN_VERSION) {
    throw new TypeError("Runtime matrix order requires the v3 AgentRuntime corpus");
  }
  const pairs = manifest.caseIds.flatMap((caseId) => manifest.seeds.map((seed) =>
    ({ caseId, seed })));
  const fullOrder = pairs.flatMap((pair, index) => {
    const variants = index % 2 === 0 ? ["baseline", "candidate"] as const
      : ["candidate", "baseline"] as const;
    return variants.map((variant) => ({ ...pair, variant,
      cellId: `${variant}:${pair.caseId}:${pair.seed}` }));
  });
  const recorded = new Set(recordedCellIds);
  if (recorded.size !== recordedCellIds.length
    || [...recorded].some((id) => !fullOrder.some((cell) => cell.cellId === id))) {
    throw new TypeError("Recorded Runtime cell is duplicate or outside the frozen matrix");
  }
  return { expectedPairs: pairs.length, expectedCells: fullOrder.length,
    remaining: fullOrder.filter((cell) => !recorded.has(cell.cellId)), fullOrder };
}
