import { randomUUID } from "node:crypto";

import type { Knex } from "knex";

import { projectTraceSafeDiagnostic } from "@/diagnostics/traceSafeDiagnostics";
import {
  assertAgentRunStepTransition,
  assertAgentRunTransition,
  parseAgentRunStatus,
  parseAgentRunStepStatus,
} from "@/agentRuntime/lifecycle";

const INTERRUPTION_REASON = "interrupted-model-call";
const QUEUED_INTERRUPTION_REASON = "interrupted-before-model-call";
const WAITING_ALLOWED_ACTIONS = JSON.stringify(["inspect"]);

/**
 * Makes an interrupted Model call truthful without guessing whether the remote
 * call completed. Recovery records safe evidence and never replays the call.
 */
export async function recoverInterruptedAgentRuns(db: Knex, recoveredAt = Date.now()): Promise<void> {
  const runningDiagnostic = projectTraceSafeDiagnostic(
    {
      failureClass: "Vendor",
      stage: "runtime",
      kind: "executionFailed",
      severity: "error",
      certainty: "unknown-effect",
      expectedness: "unexpected",
      retryDisposition: "reconcile-first",
      attributes: { operation: INTERRUPTION_REASON },
    },
    "trace",
  );
  const queuedDiagnostic = projectTraceSafeDiagnostic(
    {
      failureClass: "Vendor",
      stage: "runtime",
      kind: "executionFailed",
      severity: "warning",
      certainty: "known-no-effect",
      expectedness: "unexpected",
      retryDisposition: "safe-retry",
      attributes: { operation: QUEUED_INTERRUPTION_REASON },
    },
    "trace",
  );
  if (!runningDiagnostic.ok || !queuedDiagnostic.ok) {
    throw new Error("Interrupted Agent Run diagnostic contract is invalid");
  }

  await db.transaction(async (trx) => {
    const interruptedRuns = await trx("o_agentRun").whereIn("status", ["queued", "running"]).select("id", "version", "status");

    for (const run of interruptedRuns as Array<{ id: string; version: number; status: string }>) {
      const runStatus = parseAgentRunStatus(run.status);
      const stepStatus = runStatus === "queued" ? "pending" : "running";
      const reason = runStatus === "queued" ? QUEUED_INTERRUPTION_REASON : INTERRUPTION_REASON;
      const projected = runStatus === "queued" ? queuedDiagnostic.value : runningDiagnostic.value;
      assertAgentRunTransition(runStatus, "waiting");
      const activeSteps = await trx("o_agentRunStep")
        .where({ runId: run.id, status: stepStatus })
        .orderBy("ordinal", "asc")
        .select("id", "status");
      const activeStep = activeSteps[0] as { id?: string; status?: string } | undefined;
      const stepId = activeStep?.id ?? null;
      if (activeStep?.status) assertAgentRunStepTransition(parseAgentRunStepStatus(activeStep.status), "waiting");

      await trx("o_agentRunStep").where({ runId: run.id, status: stepStatus }).update({
        status: "waiting",
        completedAt: null,
      });
      const changedRun = await trx("o_agentRun").where({ id: run.id, status: runStatus, version: run.version }).update({
        status: "waiting",
        waitingReason: reason,
        attentionReason: reason,
        allowedActions: WAITING_ALLOWED_ACTIONS,
        version: run.version + 1,
        updatedAt: recoveredAt,
        completedAt: null,
        failureDiagnostic: JSON.stringify(projected),
      });
      if (changedRun !== 1) throw new Error("Interrupted Agent Run recovery lost its state/version precondition");

      const latest = await trx("o_agentTrace").where("runId", run.id).max<{ sequence?: number }>("sequence as sequence").first();
      await trx("o_agentTrace").insert({
        id: randomUUID(),
        runId: run.id,
        stepId,
        sequence: (latest?.sequence ?? 0) + 1,
        eventType: reason,
        runStatus: "waiting",
        stepStatus: stepId ? "waiting" : null,
        diagnosticSchemaVersion: projected.schemaVersion,
        diagnostic: JSON.stringify(projected),
        createdAt: recoveredAt,
      });
    }
  });
}
