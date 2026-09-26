import type { Knex } from "knex";

import { routeAndBindSkillRunInTransaction } from "@/skillRuntime";

export class ProductionHarnessOwnershipError extends Error {
  constructor() { super("Production Harness requires the Project owner"); }
}

export class ProductionSkillSelectionError extends Error {
  constructor(readonly reason: string) {
    super(`Production Skill routing requires a unique selection: ${reason}`);
  }
}

/** Producer guidance is a read-only slice; generation effects need separate contracts. */
export async function prepareProductionSkillRun(tx: Knex.Transaction, input: {
  runId: string; projectId: number; role: "scriptAgent" | "productionAgent";
  content: string; createdAt: number; actorUserId?: number;
}, createId: () => string): Promise<void> {
  if (input.role !== "productionAgent") throw new TypeError("Production role is required");
  if (!Number.isSafeInteger(input.actorUserId) || input.actorUserId! <= 0
    || !await tx("o_project").where({ id: input.projectId,
      userId: input.actorUserId }).first("id")) {
    throw new ProductionHarnessOwnershipError();
  }
  const result = await routeAndBindSkillRunInTransaction(tx, {
    runId: input.runId, projectId: input.projectId,
    intent: "read-only-guidance", query: input.content,
    routeId: createId(), now: input.createdAt,
  });
  if (result.decision.status !== "selected" || !result.plan) {
    throw new ProductionSkillSelectionError(result.decision.status);
  }
}
