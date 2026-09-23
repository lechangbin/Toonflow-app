import { createHash } from "node:crypto";

import type { DatabaseWork } from "@/database";

import { hashGoldenEvalManifest, validateGoldenEvalManifest,
  type GoldenEvalManifest } from "./goldenEval";

export const EVALUATION_RUN_SCHEMA_VERSION = "toonflow.evaluation-run.v1" as const;
export const EVALUATION_REVISION_CONTRACT_SCHEMA_VERSION = "toonflow.evaluation-revisions.v1" as const;

export interface EvaluationRevisionContract {
  schemaVersion: typeof EVALUATION_REVISION_CONTRACT_SCHEMA_VERSION;
  runtimeRevision: string;
  toolRevisionHash: string;
  contextRevision: string;
  skillRevisionHash: string;
  modelRevision: string;
  vendorRevision: string;
  evaluationSchemaVersion: string;
  rubricRevision: string;
}

export interface FrozenEvaluationRun {
  id: string;
  suiteId: string;
  manifestHash: string;
  revisionContractHash: string;
  status: "pending";
  caseCount: number;
  createdAt: number;
}

const REVISION = /^[A-Za-z0-9._:@-]{1,128}$/;
const MAX_MANIFEST_BYTES = 1024 * 1024;

function assertRevisionContract(value: EvaluationRevisionContract, manifest: GoldenEvalManifest): void {
  if (value.schemaVersion !== EVALUATION_REVISION_CONTRACT_SCHEMA_VERSION) {
    throw new Error("Unsupported Evaluation revision contract");
  }
  for (const field of ["runtimeRevision", "toolRevisionHash", "contextRevision", "skillRevisionHash",
    "modelRevision", "vendorRevision", "evaluationSchemaVersion", "rubricRevision"] as const) {
    if (!REVISION.test(value[field])) throw new Error(`Invalid Evaluation revision: ${field}`);
  }
  if (value.rubricRevision !== manifest.qualityRubricVersion) {
    throw new Error("Evaluation rubric revision differs from frozen manifest");
  }
}

/** This step freezes inputs only. Pending cases have no observations, scores, or Agent Run provenance. */
export function createEvaluationRunStore(dependencies: {
  work: DatabaseWork;
  now(): number;
  createId(): string;
}) {
  return {
    async freeze(input: { manifestSource: string; revisions: EvaluationRevisionContract }): Promise<FrozenEvaluationRun> {
      if (typeof input.manifestSource !== "string" || Buffer.byteLength(input.manifestSource, "utf8") > MAX_MANIFEST_BYTES) {
        throw new Error("Evaluation manifest is invalid or too large");
      }
      const normalizedManifest = input.manifestSource.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const manifest = validateGoldenEvalManifest(JSON.parse(normalizedManifest) as unknown);
      assertRevisionContract(input.revisions, manifest);
      const id = dependencies.createId();
      const createdAt = dependencies.now();
      if (!REVISION.test(id) || !Number.isSafeInteger(createdAt) || createdAt < 0) {
        throw new Error("Evaluation Run identity or time is invalid");
      }
      const revisionContractJson = JSON.stringify(input.revisions);
      const manifestHash = hashGoldenEvalManifest(normalizedManifest);
      const revisionContractHash = createHash("sha256").update(revisionContractJson).digest("hex");
      await dependencies.work((db) => db.transaction(async (tx) => {
        await tx("o_evaluationRun").insert({ id, suiteId: manifest.suiteId,
          manifestSchemaVersion: manifest.schemaVersion, manifestHash, manifestJson: normalizedManifest,
          revisionContractJson, revisionContractHash, recordSchemaVersion: EVALUATION_RUN_SCHEMA_VERSION,
          status: "pending", createdAt });
        await tx("o_evaluationCase").insert(manifest.cases.map((entry) => ({
          id: `${id}:${entry.id}`, evaluationRunId: id, caseId: entry.id,
          partition: entry.partition, status: "pending", createdAt,
        })));
      }));
      return { id, suiteId: manifest.suiteId, manifestHash, revisionContractHash,
        status: "pending", caseCount: manifest.cases.length, createdAt };
    },
  };
}
