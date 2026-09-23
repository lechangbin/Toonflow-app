import { v4 as uuid } from "uuid";
import type { Knex } from "knex";

import { appendCausalTrace } from "@/agentRuntime/causalTrace";
import { projectTraceSafeDiagnostic } from "@/diagnostics/traceSafeDiagnostics";

import { TOOL_DEFINITIONS } from "./definitions";

const recoverableReadNames = Object.keys(TOOL_DEFINITIONS);

function interruptionDiagnostic(audience: "toolReceipt" | "trace") {
  const result = projectTraceSafeDiagnostic({
    failureClass: "Tool", stage: "tool-call", kind: "executionFailed", severity: "warning",
    certainty: "known-no-effect", expectedness: "unexpected", retryDisposition: "safe-retry",
  }, audience);
  if (!result.ok) throw new Error("Interrupted Tool diagnostic is invalid");
  return result.value;
}

/** A read with no live owner cannot leave a reusable pending operation forever. */
export async function recoverPendingControlledTools(db: Knex, recoveredAt = Date.now()): Promise<void> {
  const candidates = await db("o_agentToolReceipt as receipt")
    .join("o_agentRun as run", "run.id", "receipt.runId")
    .where("receipt.status", "pending")
    .whereIn("receipt.toolName", recoverableReadNames)
    .where((query) => query.whereNull("run.leaseExpiresAt").orWhere("run.leaseExpiresAt", "<=", recoveredAt))
    .select("receipt.id");
  for (const candidate of candidates) {
    await db.transaction(async (trx) => {
      const current = await trx("o_agentToolReceipt as receipt")
        .join("o_agentRun as run", "run.id", "receipt.runId")
        .where({ "receipt.id": candidate.id, "receipt.status": "pending" })
        .whereIn("receipt.toolName", recoverableReadNames)
        .select("receipt.id", "receipt.runId", "run.leaseExpiresAt", "run.status")
        .first();
      if (!current || Number(current.leaseExpiresAt ?? 0) > recoveredAt) return;
      const diagnostic = interruptionDiagnostic("toolReceipt");
      const changed = await trx("o_agentToolReceipt").where({ id: current.id, status: "pending" }).update({
        status: "failed", diagnostic: JSON.stringify(diagnostic), updatedAt: recoveredAt,
      });
      if (changed !== 1) return;
      const traceDiagnostic = interruptionDiagnostic("trace");
      await appendCausalTrace(trx, {
        id: uuid(), runId: current.runId, toolReceiptId: current.id,
        eventType: "tool.interrupted", runStatus: current.status,
        diagnostic: traceDiagnostic, createdAt: recoveredAt,
      });
    });
  }
}
