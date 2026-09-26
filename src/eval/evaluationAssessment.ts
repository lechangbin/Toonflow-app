import { createHash } from "node:crypto";

import type { DatabaseWork } from "@/database";
import { z } from "zod";

import { validateGoldenEvalManifest } from "./goldenEval";
import { createEvaluationRunRuntime } from "./evaluationRun";

export const EVALUATION_ASSESSMENT_VERSION = "toonflow.evaluation-assessment.v1" as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const identity = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u);
const rubricRevision = z.string().trim().min(1).max(128);
const caseId = z.string().regex(/^(DEV|HOLD|INC)-[A-Z]+-\d{3}$/u);
const evidenceRef = z.string().regex(/^(?:docs|data|tests|artifacts)\/[A-Za-z0-9._\/-]+$/u)
  .refine((value) => !value.split("/").includes(".."));
const assessmentSchema = z.strictObject({
  schemaVersion: z.literal(EVALUATION_ASSESSMENT_VERSION),
  evaluationRunId: identity,
  caseId,
  seed: z.number().int().nonnegative(),
  variant: z.enum(["baseline", "candidate"]),
  sourceEvidenceHash: digest,
  assessorId: identity,
  method: z.enum(["manual-review", "deterministic-check"]),
  hardGates: z.array(z.strictObject({
    id: identity, passed: z.boolean(), evidenceRefs: z.array(evidenceRef).min(1),
  })),
  artifacts: z.array(z.strictObject({ kind: identity, ref: evidenceRef, sha256: digest })),
  quality: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("pending"), rubricVersion: rubricRevision,
      score: z.null(), reviewerId: z.null(), reason: z.string().min(1).max(1000),
      evidenceRefs: z.array(evidenceRef).length(0) }),
    z.strictObject({ state: z.literal("reviewed"), rubricVersion: rubricRevision,
      score: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      reviewerId: identity, reason: z.string().min(1).max(1000),
      evidenceRefs: z.array(evidenceRef).min(1) }),
  ]),
  failureClassification: z.strictObject({ primary: identity, stage: identity,
    kind: identity }).nullable(),
  costMicros: z.null(),
  assessedAt: z.number().int().nonnegative(),
});
export type EvaluationAssessment = z.infer<typeof assessmentSchema>;
type Evaluation = ReturnType<typeof createEvaluationRunRuntime>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cellKey = (cell: { variant: string; caseId: string; seed: number }) =>
  `${cell.variant}:${cell.caseId}:${cell.seed}`;
const hasRequiredArtifacts = (assessment: EvaluationAssessment,
  requiredArtifacts: string[]) => assessment.artifacts.length === requiredArtifacts.length
  && requiredArtifacts.every((kind) => assessment.artifacts.some((artifact) => artifact.kind === kind));

/** Append-only human/deterministic assessments of production Agent Run evidence. */
export function createEvaluationAssessmentLedger(dependencies: {
  work: DatabaseWork; evaluation: Evaluation; now(): number; createId(): string;
}) {
  async function frozen(input: { evaluationRunId: string; caseId: string;
    seed: number; variant: "baseline" | "candidate" }) {
    const observed = await dependencies.evaluation.inspect(input.evaluationRunId);
    if (!observed.manifest.goldenManifestJson) {
      throw new TypeError("Assessment requires a frozen Golden manifest");
    }
    const golden = validateGoldenEvalManifest(JSON.parse(observed.manifest.goldenManifestJson));
    const definition = golden.cases.find((item) => item.id === input.caseId);
    const source = observed.cases.find((item) => cellKey(item) === cellKey(input));
    if (!definition || !source) throw new TypeError("Assessment requires an observed frozen cell");
    return { observed, golden, definition, source };
  }

  return {
    async record(input: Omit<EvaluationAssessment, "schemaVersion" | "sourceEvidenceHash" | "assessedAt"
      | "costMicros">): Promise<EvaluationAssessment> {
      const { golden, definition, source } = await frozen(input);
      const assessedAt = dependencies.now();
      const assessment = assessmentSchema.parse({ ...input,
        schemaVersion: EVALUATION_ASSESSMENT_VERSION,
        sourceEvidenceHash: hash(source), costMicros: null, assessedAt });
      if (assessment.hardGates.length !== definition.hardGates.length
        || assessment.hardGates.some((gate, index) => gate.id !== definition.hardGates[index].id)
        || assessment.quality.rubricVersion !== golden.qualityRubricVersion
        || new Set(assessment.artifacts.map((artifact) => artifact.kind)).size !== assessment.artifacts.length
        || (assessment.quality.state === "reviewed"
          && !hasRequiredArtifacts(assessment, definition.requiredArtifacts))
        || (source.runStatus !== "succeeded" && !assessment.failureClassification)
        || (source.runStatus === "succeeded" && assessment.failureClassification)) {
        throw new TypeError("Assessment differs from frozen gates, required artifacts, rubric or source failure");
      }
      const assessmentJson = JSON.stringify(assessment);
      return dependencies.work(async (db) => db.transaction(async (tx) => {
        const key = { evaluationRunId: input.evaluationRunId, caseId: input.caseId,
          seed: input.seed, variant: input.variant };
        const existing = await tx("o_agentEvaluationAssessment").where(key).first();
        if (existing) {
          const previous = assessmentSchema.parse(JSON.parse(existing.assessmentJson));
          if (existing.assessmentHash !== hash(previous)
            || JSON.stringify({ ...previous, assessedAt }) !== assessmentJson) {
            throw new Error("Evaluation assessment is already recorded or corrupt");
          }
          return previous;
        }
        const id = dependencies.createId();
        if (!identity.safeParse(id).success) throw new TypeError("Assessment identity is invalid");
        await tx("o_agentEvaluationAssessment").insert({ id, ...key,
          sourceEvidenceHash: assessment.sourceEvidenceHash,
          assessmentJson, assessmentHash: hash(assessment), createdAt: assessedAt });
        return assessment;
      }));
    },
    async inspect(evaluationRunId: string): Promise<{ expected: number; assessed: number;
      pending: string[]; assessments: EvaluationAssessment[] }> {
      const observed = await dependencies.evaluation.inspect(evaluationRunId);
      if (!observed.manifest.goldenManifestJson) {
        throw new TypeError("Assessment requires a frozen Golden manifest");
      }
      const golden = validateGoldenEvalManifest(JSON.parse(observed.manifest.goldenManifestJson));
      const sourceByKey = new Map(observed.cases.map((source) => [cellKey(source), source]));
      const expectedKeys = observed.manifest.variants.flatMap((variant) =>
        golden.cases.flatMap((item) => observed.manifest.seeds.map((seed) =>
          cellKey({ variant, caseId: item.id, seed }))));
      const rows = await dependencies.work((db) => db("o_agentEvaluationAssessment")
        .where({ evaluationRunId }));
      const assessments = new Map<string, EvaluationAssessment>();
      for (const row of rows) {
        if (hash(JSON.parse(row.assessmentJson)) !== row.assessmentHash) {
          throw new Error("Evaluation assessment evidence is corrupt");
        }
        const assessment = assessmentSchema.parse(JSON.parse(row.assessmentJson));
        const key = cellKey(assessment);
        const source = sourceByKey.get(key);
        const definition = golden.cases.find((item) => item.id === assessment.caseId);
        if (!expectedKeys.includes(key) || assessments.has(key) || !source || !definition
          || assessment.evaluationRunId !== evaluationRunId
          || row.caseId !== assessment.caseId || row.seed !== assessment.seed
          || row.variant !== assessment.variant || row.sourceEvidenceHash !== assessment.sourceEvidenceHash
          || row.createdAt !== assessment.assessedAt || !identity.safeParse(row.id).success
          || assessment.sourceEvidenceHash !== hash(source)
          || assessment.hardGates.length !== definition.hardGates.length
          || assessment.hardGates.some((gate, index) => gate.id !== definition.hardGates[index].id)
          || assessment.quality.rubricVersion !== golden.qualityRubricVersion
          || new Set(assessment.artifacts.map((artifact) => artifact.kind)).size !== assessment.artifacts.length
          || (assessment.quality.state === "reviewed"
            && !hasRequiredArtifacts(assessment, definition.requiredArtifacts))
          || (source.runStatus !== "succeeded" && !assessment.failureClassification)
          || (source.runStatus === "succeeded" && assessment.failureClassification)) {
          throw new Error("Evaluation assessment differs from frozen source evidence");
        }
        assessments.set(key, assessment);
      }
      return { expected: expectedKeys.length, assessed: assessments.size,
        pending: expectedKeys.filter((key) => !assessments.has(key)),
        assessments: expectedKeys.flatMap((key) => assessments.has(key) ? [assessments.get(key)!] : []) };
    },
  };
}
