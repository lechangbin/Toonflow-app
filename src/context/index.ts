import { createHash } from "node:crypto";

import type { DatabaseWork } from "@/database";
import { inspectPersistableText } from "@/diagnostics/traceSafeDiagnostics";

import { estimateContextTokens, planContextBudget, type ContextBudgetInput } from "./budget";
import { createProjectContextSourceLoader } from "./projectSources";
import { selectEligibleContextSources } from "./sourceSelection";
import { createCommittedToolContextSourceLoader } from "./toolSources";

export const CONTEXT_BUNDLE_SCHEMA_VERSION = "toonflow.context-bundle.v1" as const;
const IDENTIFIER = /^[A-Za-z0-9._:@-]{1,128}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export interface BuildContextBundleInput {
  runId: string;
  stepId: string;
  attemptId: string;
  projectId: number;
  role: string;
  systemContract: string;
  stepIntent: string;
  toolAndPermissionContract: string;
  modelRevision: string;
  budget: Omit<ContextBudgetInput, "mandatoryTokens" | "optionalDemandTokens">;
  novelIds: readonly number[];
  requiredNovelIds: readonly number[];
  toolReceiptIds?: readonly string[];
  requiredToolReceiptIds?: readonly string[];
  expectedRevisions: Readonly<Record<string, string>>;
  predecessorBundleId?: string;
}

export interface FrozenContextBundle {
  id: string;
  runId: string;
  stepId: string;
  attemptId: string;
  predecessorBundleId: string | null;
  manifestHash: string;
  promptHash: string;
  messages: Array<{ role: "system" | "assistant" | "user"; content: string }>;
  createdAt: number;
}

/** Production seam: build from current SQLite sources and freeze the exact Model input for one Attempt. */
export function createContextBuilder(dependencies: { work: DatabaseWork; now(): number; createId(): string }) {
  return {
    async inspect(input: { id: string; projectId: number }): Promise<FrozenContextBundle | null> {
      if (!IDENTIFIER.test(input.id) || !Number.isSafeInteger(input.projectId) || input.projectId <= 0) {
        throw new TypeError("ContextBundle inspection scope is invalid");
      }
      return dependencies.work(async (db) => {
        const row = await db("o_agentContextBundle as bundle")
          .join("o_agentRun as run", "run.id", "bundle.runId")
          .where({ "bundle.id": input.id, "run.projectId": input.projectId })
          .first("bundle.*");
        if (!row) return null;
        if (row.schemaVersion !== CONTEXT_BUNDLE_SCHEMA_VERSION
          || hash(row.manifestJson) !== row.manifestHash
          || hash(row.messagesJson) !== row.promptHash) {
          throw new Error("ContextBundle evidence is corrupt");
        }
        let manifest: { schemaVersion?: string; promptHash?: string };
        let messages: FrozenContextBundle["messages"];
        try {
          manifest = JSON.parse(row.manifestJson);
          messages = JSON.parse(row.messagesJson);
        } catch { throw new Error("ContextBundle evidence is corrupt"); }
        if (manifest.schemaVersion !== CONTEXT_BUNDLE_SCHEMA_VERSION
          || manifest.promptHash !== row.promptHash || !Array.isArray(messages)
          || messages.length < 3 || messages.some((message) =>
            !["system", "assistant", "user"].includes(message.role)
            || typeof message.content !== "string" || !inspectPersistableText(message.content).ok)) {
          throw new Error("ContextBundle evidence is corrupt");
        }
        return { id: row.id, runId: row.runId, stepId: row.stepId, attemptId: row.attemptId,
          predecessorBundleId: row.predecessorBundleId ?? null, manifestHash: row.manifestHash,
          promptHash: row.promptHash, messages, createdAt: row.createdAt };
      });
    },
    async build(input: BuildContextBundleInput): Promise<FrozenContextBundle> {
      if (![input.runId, input.stepId, input.attemptId, input.modelRevision].every((id) => IDENTIFIER.test(id))
        || (input.predecessorBundleId !== undefined && !IDENTIFIER.test(input.predecessorBundleId))
        || !input.role.trim() || input.systemContract.trim().length === 0
        || input.stepIntent.trim().length === 0 || input.toolAndPermissionContract.trim().length === 0
        || input.requiredNovelIds.some((id) => !input.novelIds.includes(id))
        || (input.requiredToolReceiptIds ?? []).some((id) => !(input.toolReceiptIds ?? []).includes(id))) {
        throw new TypeError("ContextBundle request is invalid");
      }
      for (const content of [input.systemContract, input.stepIntent, input.toolAndPermissionContract]) {
        if (!inspectPersistableText(content).ok) throw new Error("ContextBundle contains unsafe mandatory text");
      }
      const id = dependencies.createId();
      const createdAt = dependencies.now();
      if (!IDENTIFIER.test(id) || !Number.isSafeInteger(createdAt) || createdAt < 0) {
        throw new TypeError("ContextBundle identity or time is invalid");
      }
      return dependencies.work((db) => db.transaction(async (tx) => {
        const run = await tx("o_agentRun").where({ id: input.runId, projectId: input.projectId, role: input.role }).first();
        const step = await tx("o_agentRunStep").where({ id: input.stepId, runId: input.runId }).first();
        const attempt = await tx("o_agentRunAttempt").where({ id: input.attemptId,
          runId: input.runId, stepId: input.stepId, status: "preparing" }).first();
        if (!run || !step || !attempt) throw new Error("ContextBundle requires a preparing Agent Attempt in scope");
        if (input.predecessorBundleId) {
          const predecessor = await tx("o_agentContextBundle").where({ id: input.predecessorBundleId,
            runId: input.runId, stepId: input.stepId }).first("id");
          if (!predecessor) throw new Error("ContextBundle predecessor is outside this Step");
        }
        const sourceLoader = createProjectContextSourceLoader(async (operation) => operation(tx));
        const sources = [
          ...await sourceLoader.load({ projectId: input.projectId, novelIds: input.novelIds }),
          ...await createCommittedToolContextSourceLoader(async (operation) => operation(tx)).load({
            runId: input.runId, projectId: input.projectId, receiptIds: input.toolReceiptIds ?? [],
          }),
        ];
        const mandatoryMessages = [
          { role: "system" as const, content: input.systemContract },
          { role: "system" as const, content: `Project ${input.projectId}; Agent role ${input.role}; ${input.toolAndPermissionContract}` },
          { role: "user" as const, content: input.stepIntent },
        ];
        const mandatoryTokens = mandatoryMessages.reduce((sum, message) => sum + estimateContextTokens(message.content), 0);
        const optionalDemandTokens = {
          authoritative: sources.filter((source) => source.category === "authoritative")
            .reduce((sum, source) => sum + estimateContextTokens(source.content), 0),
          toolResults: sources.filter((source) => source.category === "toolResults")
            .reduce((sum, source) => sum + estimateContextTokens(source.content), 0),
          recentInteraction: 0, memory: 0,
        };
        const budget = planContextBudget({ ...input.budget, mandatoryTokens, optionalDemandTokens });
        const selection = selectEligibleContextSources({ projectId: input.projectId, role: input.role,
          requiredSourceIds: [`project:${input.projectId}`, ...input.requiredNovelIds.map((novelId) => `novel:${novelId}`),
            ...(input.requiredToolReceiptIds ?? []).map((receiptId) => `tool:${receiptId}`)],
          expectedRevisions: input.expectedRevisions }, sources, budget);
        const messages: FrozenContextBundle["messages"] = [mandatoryMessages[0], mandatoryMessages[1],
          ...selection.selectedContent.map((content) => ({ role: "assistant" as const, content })), mandatoryMessages[2]];
        const messagesJson = JSON.stringify(messages);
        const promptHash = hash(messagesJson);
        const manifestJson = JSON.stringify({ schemaVersion: CONTEXT_BUNDLE_SCHEMA_VERSION,
          modelRevision: input.modelRevision, budget, sources: selection.selected,
          omissions: selection.omissions, promptHash });
        const manifestHash = hash(manifestJson);
        await tx("o_agentContextBundle").insert({ id, runId: input.runId, stepId: input.stepId,
          attemptId: input.attemptId, predecessorBundleId: input.predecessorBundleId ?? null,
          schemaVersion: CONTEXT_BUNDLE_SCHEMA_VERSION, manifestJson, manifestHash,
          messagesJson, promptHash, createdAt });
        return { id, runId: input.runId, stepId: input.stepId, attemptId: input.attemptId,
          predecessorBundleId: input.predecessorBundleId ?? null, manifestHash, promptHash, messages, createdAt };
      }));
    },
  };
}
