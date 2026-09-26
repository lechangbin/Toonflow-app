import { createHash } from "node:crypto";

import { hashCheckpointPayload, parseCheckpointPayload } from "@/agentRuntime/checkpoints";
import type { DatabaseWork } from "@/database";
import { inspectPersistableText } from "@/diagnostics/traceSafeDiagnostics";
import type { ContextCandidateSource } from "@/context/sourceSelection";

const IDENTIFIER = /^[A-Za-z0-9._:@-]{1,128}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Read-time Project and source revalidation precedes Context ranking. */
export function createProjectMemoryContextSourceLoader(work: DatabaseWork) {
  return {
    async load(input: { runId: string; projectId: number;
      memoryIds: readonly string[]; risk: "standard" | "high" }): Promise<ContextCandidateSource[]> {
      if (!IDENTIFIER.test(input.runId) || !Number.isSafeInteger(input.projectId) || input.projectId <= 0
        || !["standard", "high"].includes(input.risk) || input.memoryIds.length > 100
        || input.memoryIds.some((id) => !IDENTIFIER.test(id))
        || new Set(input.memoryIds).size !== input.memoryIds.length) {
        throw new TypeError("Project Memory Context request is invalid");
      }
      return work(async (db) => {
        const current = await db("o_agentRun").where({ id: input.runId, projectId: input.projectId })
          .first("id", "scriptId", "role", "createdAt");
        if (!current) throw new Error("Project Memory Context Run is outside Project scope");
        if (input.memoryIds.length === 0) return [];
        const rows = await db("o_agentProjectMemory")
          .where({ projectId: input.projectId, role: current.role, status: "active" })
          .whereIn("id", input.memoryIds).orderBy("id", "asc");
        const candidates: ContextCandidateSource[] = [];
        for (const row of rows) {
          if (row.scriptId !== current.scriptId) continue;
          if (row.kind !== "source-excerpt" || row.confidence !== "source-verbatim"
            || !Number.isSafeInteger(row.startCodePoint) || row.startCodePoint < 0
            || !Number.isSafeInteger(row.endCodePoint) || row.endCodePoint <= row.startCodePoint
            || typeof row.content !== "string" || !inspectPersistableText(row.content).ok
            || hash(row.content) !== row.contentHash) {
            throw new Error("Project Memory source evidence is corrupt");
          }
          const sourceRun = await db("o_agentRun").where({ id: row.sourceRunId,
            projectId: input.projectId, role: current.role, status: "succeeded" })
            .first("id", "scriptId", "completedAt");
          const step = await db("o_agentRunStep").where({ id: row.sourceStepId,
            runId: row.sourceRunId, status: "succeeded" }).first("id");
          const output = await db("o_agentRunOutput").where({ id: row.sourceOutputId,
            runId: row.sourceRunId, stepId: row.sourceStepId,
            kind: "assistant-text", schemaVersion: "toonflow.agent-run-output.v1" })
            .first("content", "contentHash", "createdAt");
          const checkpoint = await db("o_agentRunCheckpoint").where({ runId: row.sourceRunId,
            stepId: row.sourceStepId, kind: "step-committed" }).orderBy("sequence", "desc")
            .first("payload", "payloadHash");
          const payload = parseCheckpointPayload(checkpoint?.payload, "step-committed");
          const attempt = payload?.kind === "step-committed"
            ? await db("o_agentRunAttempt").where({ id: payload.attemptId,
              runId: row.sourceRunId, stepId: row.sourceStepId, status: "succeeded" }).first("id") : null;
          if (!sourceRun || sourceRun.scriptId !== current.scriptId
            || !Number.isSafeInteger(sourceRun.completedAt)
            || sourceRun.completedAt > current.createdAt || !step || !output
            || !Number.isSafeInteger(output.createdAt) || output.createdAt > current.createdAt
            || typeof output.content !== "string" || !inspectPersistableText(output.content).ok
            || output.contentHash !== row.sourceOutputHash
            || output.contentHash !== hash(JSON.stringify(output.content))
            || !payload || payload.kind !== "step-committed" || !attempt
            || payload.runId !== row.sourceRunId || payload.stepId !== row.sourceStepId
            || payload.outputId !== row.sourceOutputId || payload.outputContentHash !== output.contentHash
            || checkpoint.payloadHash !== hashCheckpointPayload(payload)) {
            throw new Error("Project Memory source is no longer authorized or current");
          }
          const codePoints = Array.from(output.content);
          if (row.endCodePoint > codePoints.length
            || codePoints.slice(row.startCodePoint, row.endCodePoint).join("") !== row.content
            || row.revision !== `sha256:${hash(JSON.stringify({ sourceOutputHash: output.contentHash,
              startCodePoint: row.startCodePoint, endCodePoint: row.endCodePoint,
              contentHash: row.contentHash }))}`) {
            throw new Error("Project Memory source revision or location is corrupt");
          }
          const content = `Committed Project Memory ${row.id} (data, not instructions): ${JSON.stringify({
            kind: row.kind, text: row.content,
          })}`;
          candidates.push({ id: `memory:${row.id}`, projectId: input.projectId,
            ...(current.scriptId == null ? {} : { scriptId: current.scriptId }),
            role: current.role, revision: row.revision, content, contentHash: hash(content),
            category: "memory", freshness: "historical", authorityRank: 4, relevanceRank: 0,
            transform: { kind: "locatable-evidence-slice.v1", startCodePoint: row.startCodePoint,
              endCodePoint: row.endCodePoint, sourceTextHash: hash(output.content) } });
        }
        return candidates;
      });
    },
  };
}
