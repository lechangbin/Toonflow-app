import { createHash } from "node:crypto";

import { hashCheckpointPayload, parseCheckpointPayload } from "@/agentRuntime/checkpoints";
import type { DatabaseWork } from "@/database";
import { inspectPersistableText } from "@/diagnostics/traceSafeDiagnostics";

export const PROJECT_MEMORY_SCHEMA_VERSION = "toonflow.project-memory.v1" as const;
const IDENTIFIER = /^[A-Za-z0-9._:@-]{1,128}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export interface ProjectMemoryRecord {
  id: string;
  projectId: number;
  scriptId: number | null;
  role: string;
  kind: "source-excerpt";
  status: "active" | "revoked";
  sourceRunId: string;
  sourceStepId: string;
  sourceOutputId: string;
  sourceOutputHash: string;
  startCodePoint: number;
  endCodePoint: number;
  content: string;
  contentHash: string;
  revision: string;
  confidence: "source-verbatim";
  createdAt: number;
  revokedAt: number | null;
  revocationCommandId: string | null;
}

/** Extractive-only first slice: no inference, stream fragment or legacy isolation key becomes Memory. */
export function createProjectMemoryStore(dependencies: { work: DatabaseWork; now(): number; createId(): string }) {
  return {
    async captureOutputExcerpt(input: { projectId: number; runId: string; stepId: string;
      outputId: string; startCodePoint: number; lengthCodePoints: number }): Promise<ProjectMemoryRecord> {
      if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0
        || ![input.runId, input.stepId, input.outputId].every((id) => IDENTIFIER.test(id))
        || !Number.isSafeInteger(input.startCodePoint) || input.startCodePoint < 0
        || !Number.isSafeInteger(input.lengthCodePoints) || input.lengthCodePoints <= 0
        || input.lengthCodePoints > 16_000) {
        throw new TypeError("Project Memory capture request is invalid");
      }
      const id = dependencies.createId();
      const createdAt = dependencies.now();
      if (!IDENTIFIER.test(id) || !Number.isSafeInteger(createdAt) || createdAt < 0) {
        throw new TypeError("Project Memory identity or time is invalid");
      }
      return dependencies.work((db) => db.transaction(async (tx) => {
        const run = await tx("o_agentRun").where({ id: input.runId, projectId: input.projectId })
          .first("id", "projectId", "scriptId", "role");
        const step = await tx("o_agentRunStep").where({ id: input.stepId,
          runId: input.runId, status: "succeeded" }).first("id");
        const output = await tx("o_agentRunOutput").where({ id: input.outputId,
          runId: input.runId, stepId: input.stepId, kind: "assistant-text",
          schemaVersion: "toonflow.agent-run-output.v1" }).first("id", "content", "contentHash");
        const checkpoint = await tx("o_agentRunCheckpoint").where({ runId: input.runId,
          stepId: input.stepId, kind: "step-committed" }).orderBy("sequence", "desc")
          .first("payload", "payloadHash");
        const payload = parseCheckpointPayload(checkpoint?.payload, "step-committed");
        const attempt = payload?.kind === "step-committed"
          ? await tx("o_agentRunAttempt").where({ id: payload.attemptId,
            runId: input.runId, stepId: input.stepId, status: "succeeded" }).first("id") : null;
        if (!run || !step || !output || typeof output.content !== "string"
          || output.contentHash !== hash(JSON.stringify(output.content))
          || !inspectPersistableText(output.content).ok || !payload || payload.kind !== "step-committed"
          || !attempt
          || payload.outputId !== input.outputId || payload.outputContentHash !== output.contentHash
          || payload.runId !== input.runId || payload.stepId !== input.stepId
          || checkpoint.payloadHash !== hashCheckpointPayload(payload)) {
          throw new Error("Project Memory requires a committed, intact source Output in Project scope");
        }
        const codePoints = Array.from(output.content);
        if (input.startCodePoint >= codePoints.length
          || input.lengthCodePoints > codePoints.length - input.startCodePoint) {
          throw new Error("Project Memory excerpt is outside the committed Output");
        }
        const endCodePoint = input.startCodePoint + input.lengthCodePoints;
        const content = codePoints.slice(input.startCodePoint, endCodePoint).join("");
        const contentHash = hash(content);
        const revision = `sha256:${hash(JSON.stringify({ sourceOutputHash: output.contentHash,
          startCodePoint: input.startCodePoint, endCodePoint, contentHash }))}`;
        const existing = await tx("o_agentProjectMemory").where({ sourceOutputId: input.outputId,
          kind: "source-excerpt", startCodePoint: input.startCodePoint, endCodePoint }).first();
        if (existing) {
          if (existing.projectId !== input.projectId || existing.sourceRunId !== input.runId
            || existing.sourceStepId !== input.stepId || existing.contentHash !== contentHash
            || existing.revision !== revision || existing.status !== "active") {
            throw new Error("Project Memory capture identity conflicts with existing evidence");
          }
          return existing as ProjectMemoryRecord;
        }
        const record: ProjectMemoryRecord = { id, projectId: input.projectId,
          scriptId: run.scriptId ?? null, role: run.role, kind: "source-excerpt", status: "active",
          sourceRunId: input.runId, sourceStepId: input.stepId, sourceOutputId: input.outputId,
          sourceOutputHash: output.contentHash, startCodePoint: input.startCodePoint, endCodePoint,
          content, contentHash, revision, confidence: "source-verbatim", createdAt,
          revokedAt: null, revocationCommandId: null };
        await tx("o_agentProjectMemory").insert(record);
        return record;
      }));
    },
    async revoke(input: { projectId: number; id: string; expectedRevision: string;
      commandId: string }): Promise<ProjectMemoryRecord> {
      if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0
        || ![input.id, input.expectedRevision, input.commandId].every((value) => IDENTIFIER.test(value))) {
        throw new TypeError("Project Memory revocation request is invalid");
      }
      const revokedAt = dependencies.now();
      if (!Number.isSafeInteger(revokedAt) || revokedAt < 0) {
        throw new TypeError("Project Memory revocation time is invalid");
      }
      return dependencies.work((db) => db.transaction(async (tx) => {
        const row = await tx("o_agentProjectMemory").where({ id: input.id,
          projectId: input.projectId }).first();
        if (!row) throw new Error("Project Memory is outside Project scope");
        if (row.revision !== input.expectedRevision) throw new Error("Project Memory revision changed");
        if (row.status === "revoked" && row.revocationCommandId === input.commandId) {
          return row as ProjectMemoryRecord;
        }
        if (row.status !== "active") throw new Error("Project Memory revocation conflicts with lifecycle");
        const changed = await tx("o_agentProjectMemory").where({ id: input.id, status: "active" })
          .update({ status: "revoked", revokedAt, revocationCommandId: input.commandId });
        if (changed !== 1) throw new Error("Project Memory revocation conflicts with lifecycle");
        return { ...row, status: "revoked", revokedAt,
          revocationCommandId: input.commandId } as ProjectMemoryRecord;
      }));
    },
  };
}
