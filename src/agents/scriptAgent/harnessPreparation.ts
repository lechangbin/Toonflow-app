import type { Knex } from "knex";

import { routeAndBindSkillRunInTransaction } from "@/skillRuntime";

export const SCRIPT_HARNESS_INTENT = "read-only-guidance" as const;

export class ScriptSkillSelectionError extends Error {
  constructor(readonly reason: "needs-attention" | "unavailable") {
    super(`Script Agent Skill routing requires a unique selection: ${reason}`);
  }
}

export class ScriptHarnessOwnershipError extends Error {
  constructor() { super("Script Harness requires the Project owner"); }
}

/** Opt-in Script Run preparation. Missing or ambiguous Skills fail before Model scheduling. */
export async function prepareScriptSkillRun(tx: Knex.Transaction, input: {
  runId: string; projectId: number; role: "scriptAgent";
  content: string; createdAt: number; actorUserId?: number;
}, createId: () => string): Promise<void> {
  if (!Number.isSafeInteger(input.actorUserId) || input.actorUserId! <= 0
    || !await tx("o_project").where({ id: input.projectId,
      userId: input.actorUserId }).first("id")) {
    throw new ScriptHarnessOwnershipError();
  }
  const result = await routeAndBindSkillRunInTransaction(tx, {
    runId: input.runId, projectId: input.projectId,
    intent: SCRIPT_HARNESS_INTENT, query: input.content,
    routeId: createId(), now: input.createdAt,
  });
  if (result.decision.status !== "selected" || !result.plan) {
    throw new ScriptSkillSelectionError(result.decision.status === "selected"
      ? "unavailable" : result.decision.status);
  }
}
