import { createHash } from "node:crypto";

import { hashAgentRuntimeCorpus, validateAgentRuntimeCorpus } from "./agentRuntimeCorpus";
import { inspectAgentRuntimeProjectFixtureSource } from "./agentRuntimeProjectFixture";
import { createEvaluationRunRuntime, hashEvaluationInput,
  RUNTIME_CORPUS_EVALUATION_RUN_VERSION, type EvaluationRunManifest } from "./evaluationRun";

type Evaluation = ReturnType<typeof createEvaluationRunRuntime>;

/** Freeze a verified Runtime corpus; no case is executed and no gate is scored here. */
export async function freezeAgentRuntimeEvaluationRun(evaluation: Evaluation, input: {
  manifestSource: string;
  studyId: string;
  seeds: number[];
  baseline: EvaluationRunManifest["baseline"];
  candidate: EvaluationRunManifest["candidate"];
  frozenAt: number;
  projectIds: Record<string, number>;
  readFixture(path: string): Promise<string | Buffer>;
}) {
  if (typeof input.manifestSource !== "string"
    || Buffer.byteLength(input.manifestSource, "utf8") > 1024 * 1024) {
    throw new TypeError("AgentRuntime corpus source is missing or too large");
  }
  const agentRuntimeCorpusJson = input.manifestSource.replace(/\r\n?/gu, "\n");
  const corpus = validateAgentRuntimeCorpus(JSON.parse(agentRuntimeCorpusJson) as unknown);
  if (Object.keys(input.projectIds).length !== corpus.cases.length
    || corpus.cases.some((entry) => !Number.isSafeInteger(input.projectIds[entry.id])
      || input.projectIds[entry.id] <= 0)) {
    throw new TypeError("AgentRuntime corpus Project bindings are incomplete");
  }
  const actorUserIds = new Map<string, number>();
  for (const entry of corpus.cases) {
    const bytes = await input.readFixture(entry.fixture.path);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== entry.fixture.sha256) {
      throw new TypeError(`AgentRuntime corpus fixture hash differs for ${entry.id}`);
    }
    actorUserIds.set(entry.id,
      inspectAgentRuntimeProjectFixtureSource(bytes, entry.fixture.sha256).ownerUserId);
  }
  return evaluation.create({ schemaVersion: RUNTIME_CORPUS_EVALUATION_RUN_VERSION,
    studyId: input.studyId, caseManifestHash: hashAgentRuntimeCorpus(agentRuntimeCorpusJson),
    agentRuntimeCorpusJson, caseIds: corpus.cases.map((entry) => entry.id),
    caseInputs: corpus.cases.map((entry) => ({ caseId: entry.id,
      projectId: input.projectIds[entry.id], contentHash: hashEvaluationInput(entry.content),
      role: entry.role, scope: entry.scope, actorUserId: actorUserIds.get(entry.id)! })),
    seeds: input.seeds, variants: ["baseline", "candidate"],
    baseline: input.baseline, candidate: input.candidate, frozenAt: input.frozenAt });
}
