import { validateAgentRuntimeCorpus } from "./agentRuntimeCorpus";
import { validateGoldenEvalManifest } from "./goldenEval";
import type { EvaluationRunManifest } from "./evaluationRun";

/** One internal reader for the two distinct frozen case-definition formats. */
export function resolveEvaluationCaseDefinitions(manifest: EvaluationRunManifest) {
  if (manifest.agentRuntimeCorpusJson !== undefined) {
    const corpus = validateAgentRuntimeCorpus(JSON.parse(manifest.agentRuntimeCorpusJson) as unknown);
    return { source: "agent-runtime-corpus" as const,
      qualityRubricVersion: corpus.qualityRubricVersion,
      cases: corpus.cases.map((entry) => ({ id: entry.id, partition: entry.partition,
        hardGates: entry.hardGates, requiredArtifacts: entry.requiredArtifacts })) };
  }
  if (manifest.goldenManifestJson !== undefined) {
    const golden = validateGoldenEvalManifest(JSON.parse(manifest.goldenManifestJson) as unknown);
    return { source: "t02-deterministic-golden" as const,
      qualityRubricVersion: golden.qualityRubricVersion,
      cases: golden.cases.map((entry) => ({ id: entry.id, partition: entry.partition,
        hardGates: entry.hardGates, requiredArtifacts: entry.requiredArtifacts })) };
  }
  throw new TypeError("Evaluation reports require frozen case definitions");
}
