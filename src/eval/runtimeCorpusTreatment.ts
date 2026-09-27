import { RUNTIME_CORPUS_EVALUATION_RUN_VERSION,
  validateEvaluationRunManifest, type EvaluationRunManifest } from "./evaluationRun";

const REVISION_AXES = ["app", "schema", "runtime", "tool", "context", "memory",
  "skill", "model", "vendor"] as const;

/** Opt-in T11 study contract: skill guidance is the only A/B variable. */
export function assertSkillOnlyRuntimeCorpusTreatment(input: EvaluationRunManifest) {
  const manifest = validateEvaluationRunManifest(input);
  if (manifest.schemaVersion !== RUNTIME_CORPUS_EVALUATION_RUN_VERSION) {
    throw new TypeError("Skill-only T11 treatment requires the AgentRuntime corpus");
  }
  const changed = REVISION_AXES.filter((axis) => manifest.baseline[axis] !== manifest.candidate[axis]);
  if (changed.length !== 1 || changed[0] !== "skill") {
    throw new TypeError("T11 comparison must change only the Skill revision");
  }
  return { caseManifestHash: manifest.caseManifestHash,
    baselineSkill: manifest.baseline.skill, candidateSkill: manifest.candidate.skill,
    expectedCells: manifest.caseIds.length * manifest.seeds.length * manifest.variants.length };
}
