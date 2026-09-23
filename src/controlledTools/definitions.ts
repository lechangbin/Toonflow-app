import { createHash } from "node:crypto";

import { z } from "zod";

const novelIdInput = z.strictObject({ novelId: z.number().int().positive() });
const novelTextOutput = z.strictObject({
  novelId: z.number().int().positive(),
  chapterIndex: z.number().int().nonnegative(),
  chapter: z.string().max(200),
  text: z.string().max(16_000),
});
const novelEventsOutput = z.strictObject({
  novelId: z.number().int().positive(),
  truncated: z.boolean(),
  events: z.array(z.strictObject({
    id: z.number().int().positive(),
    name: z.string().max(200),
    detail: z.string().max(2_000),
  })).max(20),
});

const readPolicy = Object.freeze({
  risk: Object.freeze({ mutation: "none", externalCost: "none", completion: "synchronous" }),
  capabilities: Object.freeze(["read:novel"]),
  roles: Object.freeze(["scriptAgent"]),
  scopes: Object.freeze(["read-only-project-guidance-v1"]),
  scope: "run-project",
  approval: "none",
  idempotency: "run-operation-id",
  retries: "explicit-new-operation",
  timeoutMs: 5_000,
  cancellation: "none",
  concurrency: "one-per-operation",
  commit: "receipt-after-read",
  reconciliation: "read-authoritative-project-data",
  compensation: "none",
  redaction: "fail-closed",
  contextProjection: "typed-bounded-output",
});

export const TOOL_DEFINITIONS = Object.freeze({
  get_novel_text: Object.freeze({
    name: "get_novel_text",
    revision: "toonflow.tool.get-novel-text.v1",
    inputSchema: novelIdInput,
    outputSchema: novelTextOutput,
    policy: readPolicy,
    adapterId: "novel-text-read-v1",
  }),
  get_novel_events: Object.freeze({
    name: "get_novel_events",
    revision: "toonflow.tool.get-novel-events.v1",
    inputSchema: novelIdInput,
    outputSchema: novelEventsOutput,
    policy: readPolicy,
    adapterId: "novel-events-read-v1",
  }),
});

export type ControlledToolName = keyof typeof TOOL_DEFINITIONS;
export type ControlledToolDefinition = (typeof TOOL_DEFINITIONS)[ControlledToolName];

export function toolDefinitionContractHash(definition: ControlledToolDefinition): string {
  return createHash("sha256").update(JSON.stringify({
    name: definition.name,
    revision: definition.revision,
    inputSchema: z.toJSONSchema(definition.inputSchema),
    outputSchema: z.toJSONSchema(definition.outputSchema),
    policy: definition.policy,
    adapterId: definition.adapterId,
  })).digest("hex");
}
