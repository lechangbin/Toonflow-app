import { createHash } from "node:crypto";

import { z } from "zod";

import { derivedChangeInstructionSchema } from "@/assets/derivedChangeInstruction";
import { scriptContentWriteInput, scriptWorkspaceWriteInput } from "./scriptWriteContract";
import { billableImageScopeSchema } from "./billableImageLifecycle";

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

const harnessReadPolicy = Object.freeze({ ...readPolicy,
  scopes: Object.freeze(["script-harness-guidance-v1"]) });

/** New scope gets new immutable Tool revisions; legacy v1 contracts remain inspectable. */
export const HARNESS_TOOL_DEFINITIONS = Object.freeze({
  get_novel_text: Object.freeze({ ...TOOL_DEFINITIONS.get_novel_text,
    revision: "toonflow.tool.get-novel-text.v2", policy: harnessReadPolicy }),
  get_novel_events: Object.freeze({ ...TOOL_DEFINITIONS.get_novel_events,
    revision: "toonflow.tool.get-novel-events.v2", policy: harnessReadPolicy }),
  get_script_workspace: Object.freeze({
    name: "get_script_workspace",
    revision: "toonflow.tool.get-script-workspace.v1",
    inputSchema: z.strictObject({ key: z.enum(["storySkeleton", "adaptationStrategy"]) }),
    outputSchema: z.strictObject({
      key: z.enum(["storySkeleton", "adaptationStrategy"]),
      content: z.string().max(16_000),
    }),
    policy: Object.freeze({ ...harnessReadPolicy,
      capabilities: Object.freeze(["read:script-workspace"]) }),
    adapterId: "script-workspace-read-v1",
  }),
  get_script_content: Object.freeze({
    name: "get_script_content",
    revision: "toonflow.tool.get-script-content.v1",
    inputSchema: z.strictObject({ scriptId: z.number().int().positive() }),
    outputSchema: z.strictObject({ scriptId: z.number().int().positive(),
      name: z.string().max(200), content: z.string().max(16_000) }),
    policy: Object.freeze({ ...harnessReadPolicy,
      capabilities: Object.freeze(["read:script"]) }),
    adapterId: "script-content-read-v1",
  }),
});

export type ControlledToolName = keyof typeof HARNESS_TOOL_DEFINITIONS;
export type ControlledToolDefinition = (typeof TOOL_DEFINITIONS)[keyof typeof TOOL_DEFINITIONS]
  | (typeof HARNESS_TOOL_DEFINITIONS)[ControlledToolName];

export function getControlledToolDefinition(name: ControlledToolName, revision: string): ControlledToolDefinition | null {
  const legacy = name in TOOL_DEFINITIONS
    ? TOOL_DEFINITIONS[name as keyof typeof TOOL_DEFINITIONS] : undefined;
  const harness = HARNESS_TOOL_DEFINITIONS[name];
  if (legacy?.revision === revision) return legacy;
  if (harness?.revision === revision) return harness;
  return null;
}

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

const scriptWritePolicy = Object.freeze({
  risk: Object.freeze({ mutation: "project-artifact", externalCost: "none", completion: "local-transaction" }),
  roles: Object.freeze(["scriptAgent"]),
  scopes: Object.freeze(["approved-script-write-v1"]),
  scope: "run-project",
  approval: "per-operation-exact-payload-and-target-state",
  idempotency: "run-operation-id",
  retries: "explicit-new-operation-after-conflict",
  timeoutMs: 0,
  cancellation: "before-approval-only",
  concurrency: "serialized-sqlite-transaction",
  commit: "project-effect-receipt-checkpoint-trace-atomic",
  reconciliation: "inspect-local-receipt-and-target-state",
  compensation: "none",
  redaction: "fail-closed",
  contextProjection: "bounded-approval-preview",
});

/** Frozen contracts only; execution is not registered until the approval Runtime is implemented. */
export const SCRIPT_WORKSPACE_WRITE_TOOL_DEFINITION = Object.freeze({
  name: "upsert_script_workspace_field",
  revision: "toonflow.tool.upsert-script-workspace-field.v1",
  inputSchema: scriptWorkspaceWriteInput,
  outputSchema: z.strictObject({ key: z.enum(["storySkeleton", "adaptationStrategy"]),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  policy: Object.freeze({ ...scriptWritePolicy,
    capabilities: Object.freeze(["write:script-workspace"]) }),
  adapterId: "script-workspace-local-write-v1",
});

export const SCRIPT_CONTENT_WRITE_TOOL_DEFINITION = Object.freeze({
  name: "upsert_script_content",
  revision: "toonflow.tool.upsert-script-content.v1",
  inputSchema: scriptContentWriteInput,
  outputSchema: z.strictObject({ scriptId: z.number().int().positive(),
    effect: z.enum(["created", "updated"]),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  policy: Object.freeze({ ...scriptWritePolicy,
    capabilities: Object.freeze(["write:script"]) }),
  adapterId: "script-content-local-write-v1",
});

const scriptProposalPolicy = Object.freeze({
  risk: Object.freeze({ mutation: "none", externalCost: "none", completion: "synchronous" }),
  roles: Object.freeze(["scriptAgent"]),
  scopes: Object.freeze(["script-harness-guidance-v1"]),
  scope: "run-project",
  approval: "proposal-only-owner-decision-required",
  idempotency: "run-operation-id",
  retries: "explicit-new-operation",
  timeoutMs: 0,
  cancellation: "proposal-survives-parent-run-cancellation",
  concurrency: "serialized-sqlite-transaction",
  commit: "child-approval-run-before-model-result",
  reconciliation: "inspect-child-approval-run",
  compensation: "none",
  redaction: "fail-closed",
  contextProjection: "bounded-approval-preview",
});

/** Model-facing proposals have no write effect; the separate Owner decision Tool owns mutation. */
export const SCRIPT_PROPOSAL_TOOL_DEFINITIONS = Object.freeze({
  propose_script_workspace_write: Object.freeze({
    name: "propose_script_workspace_write",
    revision: "toonflow.tool.propose-script-workspace-write.v1",
    inputSchema: scriptWorkspaceWriteInput,
    outputSchema: z.strictObject({ approvalRunId: z.string().min(1),
      approvalId: z.string().min(1), status: z.literal("pending") }),
    policy: Object.freeze({ ...scriptProposalPolicy,
      capabilities: Object.freeze(["propose:script-workspace"]) }),
    adapterId: "script-workspace-approval-proposal-v1",
  }),
  propose_script_content_write: Object.freeze({
    name: "propose_script_content_write",
    revision: "toonflow.tool.propose-script-content-write.v1",
    inputSchema: scriptContentWriteInput,
    outputSchema: z.strictObject({ approvalRunId: z.string().min(1),
      approvalId: z.string().min(1), status: z.literal("pending") }),
    policy: Object.freeze({ ...scriptProposalPolicy,
      capabilities: Object.freeze(["propose:script"]) }),
    adapterId: "script-content-approval-proposal-v1",
  }),
});

export const BILLABLE_IMAGE_TOOL_DEFINITION = Object.freeze({
  name: "generate_asset_image",
  revision: "toonflow.tool.generate-asset-image.v1",
  inputSchema: billableImageScopeSchema,
  outputSchema: z.strictObject({
    assetId: z.number().int().positive(),
    imageId: z.number().int().positive(),
    artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  policy: Object.freeze({
    risk: Object.freeze({ mutation: "project-artifact", externalCost: "billable", completion: "asynchronous" }),
    capabilities: Object.freeze(["generate:asset-image"]),
    roles: Object.freeze(["productionAgent"]),
    scopes: Object.freeze(["approved-billable-image-v1"]),
    scope: "run-project",
    approval: "per-request-exact-billable-scope",
    idempotency: "one-dispatch-per-approval",
    retries: "new-operation-and-approval-only",
    timeoutMs: 0,
    cancellation: "intent-does-not-revoke-provider-effect",
    concurrency: "one-vendor-request-per-tool-call",
    commit: "request-intent-before-external-call-artifact-before-success",
    reconciliation: "verified-provider-task-or-manual-no-auto-replay",
    compensation: "none",
    redaction: "fail-closed",
    contextProjection: "typed-bounded-output",
  }),
  adapterId: "billable-asset-image-v1",
});

export function toolDefinitionContractHash(definition: ControlledToolDefinition | typeof DERIVED_ASSET_TOOL_DEFINITION
  | typeof BILLABLE_IMAGE_TOOL_DEFINITION | typeof SCRIPT_WORKSPACE_WRITE_TOOL_DEFINITION
  | typeof SCRIPT_CONTENT_WRITE_TOOL_DEFINITION
  | (typeof SCRIPT_PROPOSAL_TOOL_DEFINITIONS)[keyof typeof SCRIPT_PROPOSAL_TOOL_DEFINITIONS]): string {
  return createHash("sha256").update(JSON.stringify({
    name: definition.name,
    revision: definition.revision,
    inputSchema: z.toJSONSchema(definition.inputSchema),
    outputSchema: z.toJSONSchema(definition.outputSchema),
    policy: definition.policy,
    adapterId: definition.adapterId,
  })).digest("hex");
}
