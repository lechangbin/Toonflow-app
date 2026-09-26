import type { AgentRuntime, StartAgentRunInput } from "@/agentRuntime";

import { validateAgentRuntimeCorpus, type AgentRuntimeCorpus } from "./agentRuntimeCorpus";
import { createEvaluationRunRuntime, evaluationCaseRequestId,
  hashEvaluationInput, parseEvaluationRevisions,
  type EvaluationRunManifest } from "./evaluationRun";

type Evaluation = ReturnType<typeof createEvaluationRunRuntime>;
type Variant = "baseline" | "candidate";
type RevisionSet = EvaluationRunManifest["baseline"];
type Fixture = AgentRuntimeCorpus["cases"][number]["fixture"];

/** Uses the same AgentRuntime instance as production; scheduling remains an injected boundary. */
export function createEvaluationAgentCase(dependencies: {
  evaluation: Evaluation;
  runtime: AgentRuntime;
  currentRevisions(): Promise<RevisionSet>;
  awaitScheduledWork(): Promise<void>;
  verifyProjectFixture?(input: { projectId: number; fixture: Fixture }): Promise<void>;
}) {
  async function verifyCaseFixture(manifest: EvaluationRunManifest, caseId: string,
    projectId: number): Promise<void> {
    if (manifest.agentRuntimeCorpusJson === undefined) return;
    if (!dependencies.verifyProjectFixture) {
      throw new TypeError("AgentRuntime corpus execution requires Project fixture verification");
    }
    const corpus = validateAgentRuntimeCorpus(JSON.parse(manifest.agentRuntimeCorpusJson) as unknown);
    const definition = corpus.cases.find((entry) => entry.id === caseId);
    if (!definition) throw new TypeError("AgentRuntime corpus case is missing");
    await dependencies.verifyProjectFixture({ projectId, fixture: definition.fixture });
  }
  async function execute(input: { evaluationRunId: string; caseId: string; seed: number;
      variant: Variant; projectId: number; actorUserId?: number;
      role: StartAgentRunInput["role"]; scope: StartAgentRunInput["scope"];
      content: string }) {
      const frozen = await dependencies.evaluation.inspect(input.evaluationRunId);
      if (!frozen.manifest.caseIds.includes(input.caseId)
        || !frozen.manifest.seeds.includes(input.seed)
        || !frozen.manifest.variants.includes(input.variant)) {
        throw new TypeError("Evaluation case is outside the frozen matrix");
      }
      const frozenInput = frozen.manifest.caseInputs.find((entry) => entry.caseId === input.caseId);
      if (frozenInput?.actorUserId !== undefined
        && input.actorUserId !== frozenInput.actorUserId) {
        throw new TypeError("Evaluation case actor differs from the frozen Project owner");
      }
      if (!frozenInput || !input.content.trim()
        || input.projectId !== frozenInput.projectId
        || hashEvaluationInput(input.content) !== frozenInput.contentHash
        || input.role !== frozenInput.role || input.scope !== frozenInput.scope) {
        throw new TypeError("Evaluation case content differs from the frozen input");
      }
      const declared = frozen.manifest[input.variant];
      const actual = parseEvaluationRevisions(await dependencies.currentRevisions());
      if (JSON.stringify(actual) !== JSON.stringify(declared)) {
        throw new TypeError("Evaluation Runtime revisions do not match the frozen manifest");
      }
      await verifyCaseFixture(frozen.manifest, input.caseId, input.projectId);
      const clientRequestId = evaluationCaseRequestId(input.evaluationRunId,
        input.variant, input.caseId, input.seed);
      const started = await dependencies.runtime.start({
        schemaVersion: "toonflow.agent-run.start.v1", projectId: input.projectId,
        role: input.role, scope: input.scope, clientRequestId,
        content: input.content,
        ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }),
      });
      await dependencies.awaitScheduledWork();
      const completed = await dependencies.runtime.inspect({ runId: started.id,
        projectId: input.projectId,
        ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }) });
      if (!completed || !["succeeded", "failed", "cancelled"].includes(completed.status)) {
        throw new Error("Evaluation case has no terminal production Agent Run");
      }
      await verifyCaseFixture(frozen.manifest, input.caseId, input.projectId);
      return dependencies.evaluation.record({ evaluationRunId: input.evaluationRunId,
        caseId: input.caseId, seed: input.seed, variant: input.variant,
        agentRunId: completed.id });
  }
  return {
    execute,
    /** One frozen variant at a time; await every cell and resume from verified evidence. */
    async executeVariant(input: { evaluationRunId: string; variant: Variant;
      contentByCaseId: Record<string, string>; actorUserId?: number;
      maxNewCells?: number }) {
      const frozen = await dependencies.evaluation.inspect(input.evaluationRunId);
      const { manifest } = frozen;
      if (!manifest.variants.includes(input.variant)) {
        throw new TypeError("Evaluation variant is outside the frozen matrix");
      }
      if (input.maxNewCells !== undefined
        && (!Number.isSafeInteger(input.maxNewCells) || input.maxNewCells < 1)) {
        throw new TypeError("Evaluation maxNewCells must be a positive safe integer");
      }
      const submittedCaseIds = Object.keys(input.contentByCaseId);
      if (submittedCaseIds.length !== manifest.caseIds.length
        || manifest.caseIds.some((caseId) => !Object.hasOwn(input.contentByCaseId, caseId))) {
        throw new TypeError("Evaluation case inputs differ from the frozen matrix");
      }
      for (const frozenInput of manifest.caseInputs) {
        const content = input.contentByCaseId[frozenInput.caseId];
        if (typeof content !== "string" || !content.trim()
          || hashEvaluationInput(content) !== frozenInput.contentHash) {
          throw new TypeError("Evaluation case content differs from the frozen input");
        }
        if (frozenInput.actorUserId !== undefined
          && input.actorUserId !== frozenInput.actorUserId) {
          throw new TypeError("Evaluation case actor differs from the frozen Project owner");
        }
      }
      const actual = parseEvaluationRevisions(await dependencies.currentRevisions());
      if (JSON.stringify(actual) !== JSON.stringify(manifest[input.variant])) {
        throw new TypeError("Evaluation Runtime revisions do not match the frozen manifest");
      }
      if (manifest.agentRuntimeCorpusJson !== undefined) {
        const corpus = validateAgentRuntimeCorpus(JSON.parse(manifest.agentRuntimeCorpusJson) as unknown);
        if (!dependencies.verifyProjectFixture) {
          throw new TypeError("AgentRuntime corpus execution requires Project fixture verification");
        }
        const checked = new Set<string>();
        for (const definition of corpus.cases) {
          const projectId = manifest.caseInputs.find((entry) => entry.caseId === definition.id)!.projectId;
          const key = `${projectId}:${definition.fixture.path}:${definition.fixture.sha256}`;
          if (!checked.has(key)) {
            await dependencies.verifyProjectFixture({ projectId, fixture: definition.fixture });
            checked.add(key);
          }
        }
      }
      const observed = new Set(frozen.cases.filter((cell) => cell.variant === input.variant)
        .map((cell) => `${cell.caseId}:${cell.seed}`));
      let executed = 0;
      for (const caseId of manifest.caseIds) {
        const frozenInput = manifest.caseInputs.find((entry) => entry.caseId === caseId)!;
        for (const seed of manifest.seeds) {
          if (observed.has(`${caseId}:${seed}`)) continue;
          if (executed >= (input.maxNewCells ?? Number.MAX_SAFE_INTEGER)) break;
          await execute({ evaluationRunId: input.evaluationRunId, variant: input.variant,
            caseId, seed, projectId: frozenInput.projectId,
            role: frozenInput.role, scope: frozenInput.scope,
            content: input.contentByCaseId[caseId],
            ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }) });
          executed++;
        }
      }
      const current = await dependencies.evaluation.inspect(input.evaluationRunId);
      return { expected: manifest.caseIds.length * manifest.seeds.length,
        alreadyRecorded: observed.size, executed,
        remaining: current.missing.filter((key) => key.startsWith(`${input.variant}:`)).length };
    },
  };
}
