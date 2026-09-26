import { createHash } from "node:crypto";

import { z } from "zod";

export const AGENT_RUNTIME_CORPUS_VERSION = "toonflow.agent-runtime-corpus.v1" as const;
const identity = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u);
const revision = z.string().trim().min(1).max(128);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const caseId = z.string().regex(/^(DEV|HOLD|INC)-[A-Z]+-\d{3}$/u);
const text = z.string().trim().min(1).max(1_000);
const fixture = z.strictObject({ id: identity,
  path: z.string().regex(/^data\/eval\/fixtures\/[A-Za-z0-9._/-]+\.json$/u)
    .refine((value) => !value.split("/").includes("..")), sha256: digest });
const entry = z.strictObject({ id: caseId,
  partition: z.enum(["development", "holdout", "incident-regression"]),
  title: text,
  role: z.enum(["scriptAgent", "productionAgent"]),
  scope: z.enum(["read-only-project-guidance-v1", "script-harness-guidance-v1",
    "production-harness-v1"]),
  content: z.string().trim().min(1).max(8_000),
  fixture,
  hardGates: z.array(z.strictObject({ id: identity, statement: text })).min(1),
  requiredArtifacts: z.array(identity).min(1),
  expectedFailureClass: z.strictObject({ primary: identity, stage: identity, kind: identity }),
  rubric: z.strictObject({ focus: text,
    anchors: z.array(z.strictObject({ score: z.number().int().min(0).max(2),
      description: text })).length(3) }),
});
export const agentRuntimeCorpusSchema = z.strictObject({
  schemaVersion: z.literal(AGENT_RUNTIME_CORPUS_VERSION),
  suiteId: identity, qualityRubricVersion: revision,
  cases: z.array(entry).length(18),
});
export type AgentRuntimeCorpus = z.infer<typeof agentRuntimeCorpusSchema>;

export function validateAgentRuntimeCorpus(value: unknown): AgentRuntimeCorpus {
  if (typeof value === "object" && value !== null && "cases" in value
    && Array.isArray(value.cases) && value.cases.length !== 18) {
    throw new TypeError("AgentRuntime corpus requires exactly 18 cases");
  }
  const parsed = agentRuntimeCorpusSchema.parse(value);
  const seen = new Set<string>();
  const partitions = { development: 0, holdout: 0, "incident-regression": 0 };
  for (const item of parsed.cases) {
    if (seen.has(item.id)) throw new TypeError(`AgentRuntime corpus has duplicate case ${item.id}`);
    seen.add(item.id);
    partitions[item.partition]++;
    const prefix = item.partition === "development" ? "DEV" : item.partition === "holdout" ? "HOLD" : "INC";
    if (!item.id.startsWith(`${prefix}-`)
      || (item.role === "productionAgent") !== (item.scope === "production-harness-v1")) {
      throw new TypeError("AgentRuntime corpus case partition or role/scope is incompatible");
    }
    if (new Set(item.hardGates.map((gate) => gate.id)).size !== item.hardGates.length
      || new Set(item.requiredArtifacts).size !== item.requiredArtifacts.length
      || item.rubric.anchors.some((anchor, index) => anchor.score !== index)) {
      throw new TypeError("AgentRuntime corpus case gates, artifacts or rubric are not canonical");
    }
  }
  if (partitions.development !== 12 || partitions.holdout !== 3
    || partitions["incident-regression"] !== 3
    || parsed.cases.some((item, index) => index > 0
      && (parsed.cases[index - 1].partition === "holdout" && item.partition === "development"
        || parsed.cases[index - 1].partition === "incident-regression" && item.partition !== "incident-regression"
        || parsed.cases[index - 1].partition === item.partition
          && parsed.cases[index - 1].id >= item.id))) {
    throw new TypeError("AgentRuntime corpus requires ordered 12/3/3 partitions");
  }
  return parsed;
}

export function hashAgentRuntimeCorpus(source: string | Buffer): string {
  const normalized = source.toString().replace(/\r\n?/gu, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
