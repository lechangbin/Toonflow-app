import { createHash } from "node:crypto";

import { z } from "zod";

import { derivedChangeInstructionSchema } from "@/assets/derivedChangeInstruction";

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

export const DERIVED_ASSET_TOOL_DEFINITION = Object.freeze({
  name: "upsert_derived_asset",
  revision: "toonflow.tool.upsert-derived-asset.v1",
  inputSchema: z.strictObject({
    parentAssetId: z.number().int().positive(),
    assetId: z.number().int().positive().nullable(),
    expectedVersion: z.number().int().nonnegative(),
    scriptId: z.number().int().positive(),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2_000),
    changeInstruction: derivedChangeInstructionSchema,
  }).refine((value) => JSON.stringify(value).length <= 12_000, "write payload too large"),
  outputSchema: z.strictObject({
    assetId: z.number().int().positive(),
    revision: z.number().int().positive(),
    effect: z.enum(["created", "updated"]),
  }),
  policy: Object.freeze({
    risk: Object.freeze({ mutation: "project-artifact", externalCost: "none", completion: "local-transaction" }),
    capabilities: Object.freeze(["write:derived-asset"]),
    roles: Object.freeze(["productionAgent"]),
    scopes: Object.freeze(["approved-derived-asset-write-v1"]),
    scope: "run-project",
    approval: "per-operation-exact-payload",
    idempotency: "run-operation-id",
    retries: "explicit-new-operation-after-conflict",
    timeoutMs: 0,
    cancellation: "before-approval-only",
    concurrency: "serialized-sqlite-transaction",
    commit: "asset-instruction-receipt-checkpoint-trace-atomic",
    reconciliation: "inspect-local-receipt-and-target-version",
    compensation: "none",
    redaction: "fail-closed",
    contextProjection: "typed-bounded-output",
  }),
  adapterId: "derived-asset-local-write-v1",
});

export function toolDefinitionContractHash(definition: ControlledToolDefinition | typeof DERIVED_ASSET_TOOL_DEFINITION): string {
  return createHash("sha256").update(JSON.stringify({
    name: definition.name,
    revision: definition.revision,
    inputSchema: z.toJSONSchema(definition.inputSchema),
    outputSchema: z.toJSONSchema(definition.outputSchema),
    policy: definition.policy,
    adapterId: definition.adapterId,
  })).digest("hex");
}
