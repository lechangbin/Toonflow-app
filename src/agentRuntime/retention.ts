import type { Knex } from "knex";

export const AGENT_EVIDENCE_RETENTION_SCHEMA_VERSION = "toonflow.agent-evidence-retention.v1" as const;

/** No time-based purge: unresolved external effects remain evidence for the Project lifetime. */
export const AGENT_EVIDENCE_RETENTION_POLICY = {
  schemaVersion: AGENT_EVIDENCE_RETENTION_SCHEMA_VERSION,
  databaseRetention: "project-lifetime",
  databaseDeletion: "project-delete-transaction",
  mediaDeletion: "project-directory-after-db-commit",
  redactedExportRetention: "not-persisted",
} as const;

/** Called only after owner-authorized Project deletion in the same transaction. */
export async function deleteProjectAgentEvidence(tx: Knex.Transaction, projectId: number): Promise<void> {
  if (await tx("o_project").where({ id: projectId }).first("id")) {
    throw new Error("Project deletion must precede Agent evidence purge in one transaction");
  }
  const runIds = tx("o_agentRun").where({ projectId }).select("id");
  await tx("o_agentEvidenceDeletionPermit").insert(
    tx("o_agentRun").where({ projectId }).select("id as runId"),
  );
  // Trace links every other evidence entity, so unlink it before deleting parents.
  await tx("o_agentTrace").whereIn("runId", runIds).delete();
  await tx("o_agentImageArtifact").whereIn("vendorRequestId",
    tx("o_agentVendorRequest").where({ projectId }).select("id")).delete();
  await tx("o_agentVendorRequest").where({ projectId }).delete();
  await tx("o_agentToolCall").whereIn("runId", runIds).delete();
  await tx("o_agentToolApproval").whereIn("runId", runIds).delete();
  await tx("o_agentToolReceipt").whereIn("runId", runIds).delete();
  await tx("o_agentProjectMemory").where({ projectId }).delete();
  await tx("o_agentRunOutput").whereIn("runId", runIds).delete();
  await tx("o_agentContextBundle").whereIn("runId", runIds).delete();
  await tx("o_agentSkillRouteDecision").whereIn("runId", runIds).delete();
  await tx("o_agentSkillPermissionDecision").whereIn("runId", runIds).delete();
  await tx("o_agentSkillResourceAccess").whereIn("runId", runIds).delete();
  await tx("o_agentRunSkillResolution").whereIn("runId", runIds).delete();
  await tx("o_agentRunSkillBinding").whereIn("runId", runIds).delete();
  await tx("o_agentEvidenceDeletionPermit").whereIn("runId", runIds).delete();
  await tx("o_agentRunCheckpoint").whereIn("runId", runIds).delete();
  await tx("o_agentRunCommand").whereIn("runId", runIds).delete();
  await tx("o_agentRunAttempt").whereIn("runId", runIds).delete();
  await tx("o_agentRunStep").whereIn("runId", runIds).delete();
  await tx("o_agentRun").where({ projectId }).delete();
  await tx("o_agentProjectCapabilityGrant").where({ projectId }).delete();
  await tx("o_agentImageQuotePolicy").where({ projectId }).delete();
}
