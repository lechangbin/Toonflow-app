import { v4 as uuid } from "uuid";
import type { Knex } from "knex";

import { projectTraceSafeDiagnostic } from "@/diagnostics/traceSafeDiagnostics";

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
    .where((query) => query.whereNull("run.leaseExpiresAt").orWhere("run.leaseExpiresAt", "<=", recoveredAt))
    .select("receipt.id");
  for (const candidate of candidates) {
    await db.transaction(async (trx) => {
      const current = await trx("o_agentToolReceipt as receipt")
        .join("o_agentRun as run", "run.id", "receipt.runId")
        .where({ "receipt.id": candidate.id, "receipt.status": "pending" })
        .select("receipt.id", "receipt.runId", "run.leaseExpiresAt", "run.status")
        .first();
      if (!current || Number(current.leaseExpiresAt ?? 0) > recoveredAt) return;
      const diagnostic = interruptionDiagnostic("toolReceipt");
      const changed = await trx("o_agentToolReceipt").where({ id: current.id, status: "pending" }).update({
        status: "failed", diagnostic: JSON.stringify(diagnostic), updatedAt: recoveredAt,
      });
      if (changed !== 1) return;
      const latest = await trx("o_agentTrace").where("runId", current.runId)
        .max<{ sequence?: number }>("sequence as sequence").first();
      const traceDiagnostic = interruptionDiagnostic("trace");
      await trx("o_agentTrace").insert({
        id: uuid(), runId: current.runId, toolReceiptId: current.id,
        sequence: Number(latest?.sequence ?? 0) + 1, eventType: "tool.interrupted",
        runStatus: current.status, diagnosticSchemaVersion: traceDiagnostic.schemaVersion,
        diagnostic: JSON.stringify(traceDiagnostic), createdAt: recoveredAt,
      });
    });
  }
}
