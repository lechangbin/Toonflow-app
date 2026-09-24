import { createHash } from "node:crypto";

import type { DatabaseWork } from "@/database";
import { billableImageProposalClientRequestId,
  type BillableImageApprovalSnapshot } from "@/controlledTools/billableImageApproval";
import { PRODUCTION_IMAGE_PROPOSAL_TOOL_DEFINITION } from "@/controlledTools/definitions";

export class ProductionHarnessEffectsNotFoundError extends Error {}
export class ProductionHarnessEffectsConflictError extends Error {}

export interface ProductionHarnessEffect {
  operationId: string;
  status: "denied" | "approval";
  approval: BillableImageApprovalSnapshot | null;
}

/** Read-only projection of durable child effects; model text is never an effect status. */
export function createProductionHarnessEffects(dependencies: {
  work: DatabaseWork;
  inspectBillable(projectId: number, runId: string, actorUserId: number):
    Promise<BillableImageApprovalSnapshot | null>;
}) {
  return async (input: { projectId: number; actorUserId: number; runId: string }): Promise<{
    runId: string; effects: ProductionHarnessEffect[];
  }> => {
    if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0
      || !Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.runId)) {
      throw new ProductionHarnessEffectsNotFoundError();
    }
    const entries = await dependencies.work(async (db) => {
      const parent = await db("o_agentRun as run")
        .join("o_project as project", "project.id", "run.projectId")
        .where({ "run.id": input.runId, "run.projectId": input.projectId,
          "run.role": "productionAgent", "run.scope": "production-harness-v1",
          "project.userId": input.actorUserId }).first("run.id");
      if (!parent) throw new ProductionHarnessEffectsNotFoundError();
      const decisions = await db("o_agentSkillPermissionDecision")
        .where({ runId: input.runId,
          toolName: PRODUCTION_IMAGE_PROPOSAL_TOOL_DEFINITION.name })
        .orderBy("createdAt").orderBy("id").limit(51);
      if (decisions.length > 50) throw new ProductionHarnessEffectsConflictError();
      const result: Array<{ operationId: string; allowed: boolean; childRunId: string | null }> = [];
      for (const decision of decisions) {
        if (createHash("sha256").update(decision.decisionJson).digest("hex")
          !== decision.decisionHash) throw new ProductionHarnessEffectsConflictError();
        let allowed: unknown;
        try { allowed = JSON.parse(decision.decisionJson).allowed; }
        catch { throw new ProductionHarnessEffectsConflictError(); }
        if (typeof allowed !== "boolean") throw new ProductionHarnessEffectsConflictError();
        const child = allowed && await db("o_agentRun").where({
          projectId: input.projectId, role: "productionAgent",
          scope: "approved-billable-image-v1",
          clientRequestId: billableImageProposalClientRequestId(input.runId, decision.operationId),
        }).first("id");
        if (allowed && !child) throw new ProductionHarnessEffectsConflictError();
        result.push({ operationId: decision.operationId,
          allowed, childRunId: child ? child.id : null });
      }
      return result;
    });
    const effects: ProductionHarnessEffect[] = [];
    for (const entry of entries) {
      if (!entry.allowed) {
        effects.push({ operationId: entry.operationId, status: "denied", approval: null });
        continue;
      }
      let approval: BillableImageApprovalSnapshot | null;
      try {
        approval = await dependencies.inspectBillable(input.projectId,
          entry.childRunId!, input.actorUserId);
      } catch {
        throw new ProductionHarnessEffectsConflictError();
      }
      if (!approval || approval.sourceRunId !== input.runId
        || approval.sourceOperationId !== entry.operationId) {
        throw new ProductionHarnessEffectsConflictError();
      }
      effects.push({ operationId: entry.operationId, status: "approval", approval });
    }
    return { runId: input.runId, effects };
  };
}
