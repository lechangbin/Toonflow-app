import { createHash } from "node:crypto";

import type { AgentRuntime, StartAgentRunInput } from "@/agentRuntime";

import { createEvaluationRunRuntime, parseEvaluationRevisions,
  type EvaluationRunManifest } from "./evaluationRun";

type Evaluation = ReturnType<typeof createEvaluationRunRuntime>;
type Variant = "baseline" | "candidate";
type RevisionSet = EvaluationRunManifest["baseline"];

/** Uses the same AgentRuntime instance as production; scheduling remains an injected boundary. */
export function createEvaluationAgentCase(dependencies: {
  evaluation: Evaluation;
  runtime: AgentRuntime;
  currentRevisions(): Promise<RevisionSet>;
  awaitScheduledWork(): Promise<void>;
}) {
  return {
    async execute(input: { evaluationRunId: string; caseId: string; seed: number;
      variant: Variant; projectId: number; actorUserId?: number;
      role: StartAgentRunInput["role"]; scope: StartAgentRunInput["scope"];
      content: string }) {
      const frozen = await dependencies.evaluation.inspect(input.evaluationRunId);
      if (!frozen.manifest.caseIds.includes(input.caseId)
        || !frozen.manifest.seeds.includes(input.seed)
        || !frozen.manifest.variants.includes(input.variant)) {
        throw new TypeError("Evaluation case is outside the frozen matrix");
      }
      const declared = frozen.manifest[input.variant];
      const actual = parseEvaluationRevisions(await dependencies.currentRevisions());
      if (JSON.stringify(actual) !== JSON.stringify(declared)) {
        throw new TypeError("Evaluation Runtime revisions do not match the frozen manifest");
      }
      const clientRequestId = `eval-${createHash("sha256")
        .update(JSON.stringify([input.evaluationRunId, input.variant,
          input.caseId, input.seed])).digest("hex").slice(0, 32)}`;
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
      return dependencies.evaluation.record({ evaluationRunId: input.evaluationRunId,
        caseId: input.caseId, seed: input.seed, variant: input.variant,
        agentRunId: completed.id });
    },
  };
}
