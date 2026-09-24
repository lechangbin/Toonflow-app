import type { Knex } from "knex";

import { routeAndBindSkillRunInTransaction } from "@/skillRuntime";

export const SCRIPT_HARNESS_INTENT = "read-only-guidance" as const;

/** Opt-in Script Run preparation. Missing or ambiguous Skills fail before Model scheduling. */
export async function prepareScriptSkillRun(tx: Knex.Transaction, input: {
  runId: string; projectId: number; role: "scriptAgent";
  content: string; createdAt: number;
}, createId: () => string): Promise<void> {
  const result = await routeAndBindSkillRunInTransaction(tx, {
    runId: input.runId, projectId: input.projectId,
    intent: SCRIPT_HARNESS_INTENT, query: input.content,
    routeId: createId(), now: input.createdAt,
  });
  if (result.decision.status !== "selected" || !result.plan) {
    throw new Error(`Script Agent Skill routing requires a unique selection: ${result.decision.status}`);
  }
}
