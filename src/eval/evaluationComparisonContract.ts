import { createHash } from "node:crypto";

import { hashGoldenEvalManifest, validateGoldenEvalManifest } from "./goldenEval";
import { EVALUATION_REVISION_CONTRACT_SCHEMA_VERSION, EVALUATION_RUN_SCHEMA_VERSION,
  type EvaluationRevisionContract } from "./evaluationRun";

export const EVALUATION_COMPARISON_CONTRACT_SCHEMA_VERSION = "toonflow.evaluation-comparison-contract.v1" as const;

export interface FrozenEvaluationContractRecord {
  id: string;
  suiteId: string;
  manifestHash: string;
  manifestJson: string;
  revisionContractHash: string;
  revisionContractJson: string;
  recordSchemaVersion: string;
}

export type TreatmentRevision = "runtimeRevision" | "toolRevisionHash" | "contextRevision"
  | "skillRevisionHash" | "modelRevision" | "vendorRevision";

const TREATMENT_REVISIONS: readonly TreatmentRevision[] = ["runtimeRevision", "toolRevisionHash",
  "contextRevision", "skillRevisionHash", "modelRevision", "vendorRevision"];
const ALL_REVISIONS: ReadonlyArray<TreatmentRevision | "evaluationSchemaVersion" | "rubricRevision"> =
  [...TREATMENT_REVISIONS, "evaluationSchemaVersion", "rubricRevision"];
const REVISION = /^[A-Za-z0-9._:@-]{1,128}$/;

function checkedContract(record: FrozenEvaluationContractRecord): EvaluationRevisionContract {
  if (record.recordSchemaVersion !== EVALUATION_RUN_SCHEMA_VERSION
    || hashGoldenEvalManifest(record.manifestJson) !== record.manifestHash
    || createHash("sha256").update(record.revisionContractJson).digest("hex") !== record.revisionContractHash) {
    throw new Error("Evaluation comparison rejects corrupt or unsupported frozen contract");
  }
  const manifest = validateGoldenEvalManifest(JSON.parse(record.manifestJson) as unknown);
  const revisions = JSON.parse(record.revisionContractJson) as EvaluationRevisionContract;
  if (record.suiteId !== manifest.suiteId
    || revisions.schemaVersion !== EVALUATION_REVISION_CONTRACT_SCHEMA_VERSION
    || revisions.rubricRevision !== manifest.qualityRubricVersion
    || ALL_REVISIONS.some(
      (field) => !REVISION.test(revisions[field]))) {
    throw new Error("Evaluation comparison rejects invalid frozen contract");
  }
  return revisions;
}

/** Contract compatibility only; no case scores, execution completeness, or quality conclusion is inferred. */
export function assertComparableEvaluationContracts(
  baseline: FrozenEvaluationContractRecord, candidate: FrozenEvaluationContractRecord,
): { schemaVersion: typeof EVALUATION_COMPARISON_CONTRACT_SCHEMA_VERSION;
  baselineRunId: string; candidateRunId: string; manifestHash: string;
  changedTreatmentRevisions: TreatmentRevision[] } {
  if (baseline.id === candidate.id) throw new Error("Evaluation comparison requires two distinct Runs");
  const before = checkedContract(baseline);
  const after = checkedContract(candidate);
  if (baseline.suiteId !== candidate.suiteId || baseline.manifestHash !== candidate.manifestHash
    || before.evaluationSchemaVersion !== after.evaluationSchemaVersion
    || before.rubricRevision !== after.rubricRevision) {
    throw new Error("Evaluation comparison contracts are incompatible");
  }
  return { schemaVersion: EVALUATION_COMPARISON_CONTRACT_SCHEMA_VERSION,
    baselineRunId: baseline.id, candidateRunId: candidate.id, manifestHash: baseline.manifestHash,
    changedTreatmentRevisions: TREATMENT_REVISIONS.filter((field) => before[field] !== after[field]) };
}
