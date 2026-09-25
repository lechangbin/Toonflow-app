import { createHash } from "node:crypto";

import type { DatabaseWork } from "@/database";
import { auditCausalTraceTimeline } from "@/agentRuntime/causalTrace";
import { z } from "zod";

import { hashGoldenEvalManifest, validateGoldenEvalManifest } from "./goldenEval";

export const EVALUATION_RUN_VERSION = "toonflow.evaluation-run.v2" as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const identity = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u);
const revision = z.string().trim().min(1).max(128);
const caseId = z.string().regex(/^(DEV|HOLD|INC)-[A-Z]+-\d{3}$/u);
const revisions = z.strictObject({ app: revision, schema: revision,
  runtime: revision, tool: revision, context: revision,
  memory: revision, skill: revision, model: revision, vendor: revision });
const COMMON_REVISIONS = ["schema", "model", "vendor"] as const;

export const evaluationRunManifestSchema = z.strictObject({
  schemaVersion: z.literal(EVALUATION_RUN_VERSION),
  studyId: identity,
  caseManifestHash: digest,
  goldenManifestJson: z.string().max(1024 * 1024).optional(),
  caseIds: z.array(caseId).min(1),
  caseInputs: z.array(z.strictObject({ caseId, projectId: z.number().int().positive(), contentHash: digest,
    role: z.enum(["scriptAgent", "productionAgent"]),
    scope: z.enum(["read-only-project-guidance-v1", "script-harness-guidance-v1",
      "production-harness-v1"]) })).min(1),
  seeds: z.array(z.number().int().nonnegative()).min(2),
  variants: z.tuple([z.literal("baseline"), z.literal("candidate")]),
  baseline: revisions,
  candidate: revisions,
  frozenAt: z.number().int().nonnegative(),
});
export type EvaluationRunManifest = z.infer<typeof evaluationRunManifestSchema>;
export const parseEvaluationRevisions = (input: unknown) => revisions.parse(input);

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const hashEvaluationInput = (content: string) => hash(content.trim());

export function evaluationCaseRequestId(evaluationRunId: string,
  variant: "baseline" | "candidate", caseId: string, seed: number): string {
  return `eval-${hash(JSON.stringify([evaluationRunId, variant, caseId, seed])).slice(0, 32)}`;
}

export function validateEvaluationRunManifest(input: unknown): EvaluationRunManifest {
  const manifest = evaluationRunManifestSchema.parse(input);
  if (new Set(manifest.caseIds).size !== manifest.caseIds.length
    || manifest.caseInputs.length !== manifest.caseIds.length
    || manifest.caseInputs.some((entry, index) => entry.caseId !== manifest.caseIds[index])
    || new Set(manifest.seeds).size !== manifest.seeds.length
    || manifest.seeds.some((seed, index) => index > 0 && seed <= manifest.seeds[index - 1])) {
    throw new TypeError("Evaluation Run cases or seeds are not frozen canonically");
  }
  if (COMMON_REVISIONS.some((key) => manifest.baseline[key] !== manifest.candidate[key])) {
    throw new TypeError("Evaluation comparison changed a required common environment revision");
  }
  if (manifest.goldenManifestJson !== undefined) {
    const golden = validateGoldenEvalManifest(JSON.parse(manifest.goldenManifestJson) as unknown);
    if (hashGoldenEvalManifest(manifest.goldenManifestJson) !== manifest.caseManifestHash
      || golden.cases.length !== manifest.caseIds.length
      || golden.cases.some((entry, index) => entry.id !== manifest.caseIds[index])) {
      throw new TypeError("Evaluation Run differs from the frozen Golden manifest");
    }
  }
  return manifest;
}

const caseEvidenceSchema = z.strictObject({
  caseId, seed: z.number().int().nonnegative(),
  variant: z.enum(["baseline", "candidate"]),
  agentRunId: identity, projectId: z.number().int().positive(),
  runVersion: z.number().int().positive(),
  runStatus: z.enum(["succeeded", "failed", "cancelled"]),
  runCreatedAt: z.number().int().nonnegative(),
  runCompletedAt: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  costMicros: z.null(),
  outputHash: digest.nullable(), lastTraceId: identity,
  lastTraceSequence: z.number().int().positive(),
});
type CaseEvidence = z.infer<typeof caseEvidenceSchema>;

/** A comparison ledger, not an evaluator-only Agent executor. */
export function createEvaluationRunRuntime(dependencies: {
  work: DatabaseWork; now(): number; createId(): string;
}) {
  return {
    async create(input: unknown): Promise<{ id: string; manifestHash: string }> {
      const manifest = validateEvaluationRunManifest(input);
      const id = dependencies.createId();
      const createdAt = dependencies.now();
      if (!identity.safeParse(id).success || !Number.isSafeInteger(createdAt)
        || createdAt < manifest.frozenAt) throw new TypeError("Evaluation Run identity or freeze time is invalid");
      const manifestJson = JSON.stringify(manifest);
      const manifestHash = hash(manifestJson);
      await dependencies.work(async (db) => {
        await db("o_agentEvaluationRun").insert({ id, schemaVersion: EVALUATION_RUN_VERSION,
          manifestJson, manifestHash, createdAt });
      });
      return { id, manifestHash };
    },
    async record(input: { evaluationRunId: string; caseId: string; seed: number;
      variant: "baseline" | "candidate"; agentRunId: string }): Promise<CaseEvidence> {
      if (!identity.safeParse(input.evaluationRunId).success
        || !identity.safeParse(input.agentRunId).success) throw new TypeError("Evaluation Run identity is invalid");
      return dependencies.work((db) => db.transaction(async (tx) => {
        const evaluation = await tx("o_agentEvaluationRun")
          .where({ id: input.evaluationRunId }).first();
        if (!evaluation || evaluation.schemaVersion !== EVALUATION_RUN_VERSION
          || hash(evaluation.manifestJson) !== evaluation.manifestHash) {
          throw new Error("Evaluation Run manifest is missing or corrupt");
        }
        const manifest = validateEvaluationRunManifest(JSON.parse(evaluation.manifestJson));
        if (!manifest.caseIds.includes(input.caseId) || !manifest.seeds.includes(input.seed)
          || !manifest.variants.includes(input.variant)) {
          throw new TypeError("Evaluation case is outside the frozen matrix");
        }
        const run = await tx("o_agentRun").where({ id: input.agentRunId }).first();
        if (!run || !["succeeded", "failed", "cancelled"].includes(run.status)
          || !Number.isSafeInteger(run.version) || run.version <= 0) {
          throw new Error("Evaluation case requires a terminal production Agent Run");
        }
        if (!Number.isSafeInteger(run.createdAt) || run.createdAt < 0
          || !Number.isSafeInteger(run.completedAt) || run.completedAt < run.createdAt) {
          throw new Error("Evaluation case requires valid production Run timing");
        }
        if (run.clientRequestId !== evaluationCaseRequestId(input.evaluationRunId,
          input.variant, input.caseId, input.seed)) {
          throw new Error("Evaluation case Agent Run request identity does not match the frozen cell");
        }
        const frozenInput = manifest.caseInputs.find((entry) => entry.caseId === input.caseId);
        let storedInput: unknown;
        try { storedInput = JSON.parse(run.input); } catch { /* fail closed below */ }
        if (!frozenInput || !storedInput || typeof storedInput !== "object"
          || !("content" in storedInput) || typeof storedInput.content !== "string"
          || run.projectId !== frozenInput.projectId
          || run.role !== frozenInput.role || run.scope !== frozenInput.scope
          || hashEvaluationInput(storedInput.content) !== frozenInput.contentHash) {
          throw new Error("Evaluation source Agent Run input differs from the frozen case");
        }
        const output = await tx("o_agentRunOutput").where({ runId: run.id }).first("contentHash");
        const traces = await tx("o_agentTrace").where({ runId: run.id })
          .orderBy("sequence", "asc").select("id", "sequence", "predecessorTraceId");
        const trace = traces.at(-1);
        if (auditCausalTraceTimeline(traces).linkage !== "linked"
          || !trace || !identity.safeParse(trace.id).success
          || !Number.isSafeInteger(trace.sequence) || trace.sequence <= 0
          || output && !digest.safeParse(output.contentHash).success) {
          throw new Error("Evaluation case lacks valid Agent Run evidence");
        }
        const evidence = caseEvidenceSchema.parse({ caseId: input.caseId, seed: input.seed,
          variant: input.variant, agentRunId: run.id, projectId: run.projectId,
          runVersion: run.version, runStatus: run.status,
          runCreatedAt: run.createdAt, runCompletedAt: run.completedAt,
          elapsedMs: run.completedAt - run.createdAt, costMicros: null,
          outputHash: output?.contentHash ?? null,
          lastTraceId: trace.id, lastTraceSequence: trace.sequence });
        const evidenceJson = JSON.stringify(evidence);
        const existing = await tx("o_agentEvaluationCase").where({
          evaluationRunId: input.evaluationRunId, caseId: input.caseId,
          seed: input.seed, variant: input.variant,
        }).first();
        if (existing) {
          if (existing.agentRunId !== input.agentRunId
            || hash(existing.evidenceJson) !== existing.evidenceHash) {
            throw new Error("Evaluation case was already bound to different or corrupt evidence");
          }
          if (existing.evidenceJson !== evidenceJson) {
            throw new Error("Evaluation source Agent Run evidence has changed or disappeared");
          }
          return evidence;
        }
        await tx("o_agentEvaluationCase").insert({ id: dependencies.createId(),
          evaluationRunId: input.evaluationRunId, caseId: input.caseId,
          seed: input.seed, variant: input.variant, agentRunId: input.agentRunId,
          evidenceJson, evidenceHash: hash(evidenceJson), createdAt: dependencies.now() });
        return evidence;
      }));
    },
    async inspect(id: string): Promise<{ manifest: EvaluationRunManifest;
      manifestHash: string; expected: number; recorded: number;
      missing: string[]; cases: CaseEvidence[] }> {
      if (!identity.safeParse(id).success) throw new TypeError("Evaluation Run identity is invalid");
      return dependencies.work((db) => db.transaction(async (tx) => {
        const row = await tx("o_agentEvaluationRun").where({ id }).first();
        if (!row || row.schemaVersion !== EVALUATION_RUN_VERSION
          || hash(row.manifestJson) !== row.manifestHash) {
          throw new Error("Evaluation Run manifest is missing or corrupt");
        }
        const manifest = validateEvaluationRunManifest(JSON.parse(row.manifestJson));
        const expectedKeys = manifest.variants.flatMap((variant) =>
          manifest.caseIds.flatMap((caseId) => manifest.seeds.map((seed) =>
            `${variant}:${caseId}:${seed}`)));
        const expected = new Set(expectedKeys);
        const records = await tx("o_agentEvaluationCase").where({ evaluationRunId: id });
        const seen = new Set<string>();
        const cases: CaseEvidence[] = [];
        for (const record of records) {
          if (hash(record.evidenceJson) !== record.evidenceHash) {
            throw new Error("Evaluation case evidence is corrupt");
          }
          const evidence = caseEvidenceSchema.parse(JSON.parse(record.evidenceJson));
          const key = `${evidence.variant}:${evidence.caseId}:${evidence.seed}`;
          if (!expected.has(key) || seen.has(key)
            || record.caseId !== evidence.caseId || record.seed !== evidence.seed
            || record.variant !== evidence.variant || record.agentRunId !== evidence.agentRunId) {
            throw new Error("Evaluation case is outside or inconsistent with the frozen matrix");
          }
          const run = await tx("o_agentRun").where({ id: evidence.agentRunId }).first();
          const frozenInput = manifest.caseInputs.find((entry) => entry.caseId === evidence.caseId);
          let storedInput: unknown;
          try { storedInput = run ? JSON.parse(run.input) : null; } catch { /* fail closed below */ }
          const traces = await tx("o_agentTrace").where({ runId: evidence.agentRunId })
            .orderBy("sequence", "asc").select("id", "sequence", "predecessorTraceId");
          const trace = traces.at(-1);
          const output = await tx("o_agentRunOutput").where({ runId: evidence.agentRunId })
            .first("contentHash");
          if (!run || run.projectId !== evidence.projectId
            || run.clientRequestId !== evaluationCaseRequestId(id,
              evidence.variant, evidence.caseId, evidence.seed)
            || !frozenInput || run.projectId !== frozenInput.projectId
            || run.role !== frozenInput.role || run.scope !== frozenInput.scope
            || !storedInput || typeof storedInput !== "object"
            || !("content" in storedInput) || typeof storedInput.content !== "string"
            || hashEvaluationInput(storedInput.content) !== frozenInput.contentHash
            || run.status !== evidence.runStatus || run.version !== evidence.runVersion
            || run.createdAt !== evidence.runCreatedAt
            || run.completedAt !== evidence.runCompletedAt
            || run.completedAt - run.createdAt !== evidence.elapsedMs
            || auditCausalTraceTimeline(traces).linkage !== "linked"
            || trace?.id !== evidence.lastTraceId
            || trace?.sequence !== evidence.lastTraceSequence
            || (output?.contentHash ?? null) !== evidence.outputHash) {
            throw new Error("Evaluation source Agent Run evidence has changed or disappeared");
          }
          seen.add(key);
          cases.push(evidence);
        }
        return { manifest, manifestHash: row.manifestHash,
          expected: expected.size, recorded: cases.length,
          missing: expectedKeys.filter((key) => !seen.has(key)), cases };
      }));
    },
  };
}
