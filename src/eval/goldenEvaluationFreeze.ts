import { hashGoldenEvalManifest, validateGoldenEvalManifest } from "./goldenEval";
import { createEvaluationRunRuntime, EVALUATION_RUN_VERSION,
  hashEvaluationInput, type EvaluationRunManifest } from "./evaluationRun";

type Evaluation = ReturnType<typeof createEvaluationRunRuntime>;
type CaseInput = EvaluationRunManifest["caseInputs"][number];

/** Freezes the T02 case definitions into the one production-Run evidence ledger. No case is executed here. */
export async function freezeGoldenEvaluationRun(evaluation: Evaluation, input: {
  manifestSource: string;
  studyId: string;
  seeds: number[];
  baseline: EvaluationRunManifest["baseline"];
  candidate: EvaluationRunManifest["candidate"];
  frozenAt: number;
  caseInputs: Array<{ caseId: string; projectId: number; content: string;
    role: CaseInput["role"]; scope: CaseInput["scope"] }>;
}) {
  if (typeof input.manifestSource !== "string"
    || Buffer.byteLength(input.manifestSource, "utf8") > 1024 * 1024) {
    throw new TypeError("Golden Evaluation manifest is missing or too large");
  }
  const goldenManifestJson = input.manifestSource.replace(/\r\n?/gu, "\n");
  const golden = validateGoldenEvalManifest(JSON.parse(goldenManifestJson) as unknown);
  if (golden.cases.length !== input.caseInputs.length
    || golden.cases.some((entry, index) => entry.id !== input.caseInputs[index]?.caseId
      || !input.caseInputs[index]?.content.trim())) {
    throw new TypeError("Golden Evaluation inputs do not cover the frozen case order");
  }
  return evaluation.create({ schemaVersion: EVALUATION_RUN_VERSION,
    studyId: input.studyId,
    caseManifestHash: hashGoldenEvalManifest(goldenManifestJson),
    goldenManifestJson,
    caseIds: golden.cases.map((entry) => entry.id),
    caseInputs: input.caseInputs.map((entry) => ({ caseId: entry.caseId,
      projectId: entry.projectId,
      contentHash: hashEvaluationInput(entry.content),
      role: entry.role, scope: entry.scope })),
    seeds: input.seeds, variants: ["baseline", "candidate"],
    baseline: input.baseline, candidate: input.candidate, frozenAt: input.frozenAt });
}
