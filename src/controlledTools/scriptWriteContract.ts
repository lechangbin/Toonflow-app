import { createHash } from "node:crypto";

import { z } from "zod";

import { inspectPersistableText } from "@/diagnostics/traceSafeDiagnostics";

/** Candidate payloads only. No Script mutation is authorized by parsing or hashing them. */
export const scriptWorkspaceWriteInput = z.strictObject({
  key: z.enum(["storySkeleton", "adaptationStrategy"]),
  content: z.string().min(1).max(32_000),
});

export const scriptContentWriteInput = z.discriminatedUnion("effect", [
  z.strictObject({ effect: z.literal("create"),
    name: z.string().trim().min(1).max(120), content: z.string().min(1).max(100_000) }),
  z.strictObject({ effect: z.literal("update"), scriptId: z.number().int().positive(),
    name: z.string().trim().min(1).max(120), content: z.string().min(1).max(100_000) }),
]);

export type ScriptWorkspaceWriteInput = z.infer<typeof scriptWorkspaceWriteInput>;
export type ScriptContentWriteInput = z.infer<typeof scriptContentWriteInput>;

export class ScriptWriteContentRejectedError extends Error {
  constructor() { super("Script write payload cannot be persisted safely"); }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function freezeScriptWritePayload<T extends ScriptWorkspaceWriteInput | ScriptContentWriteInput>(
  schema: z.ZodType<T>, input: unknown,
): { payload: T; payloadJson: string; payloadHash: string } {
  const payload = schema.parse(input);
  const payloadJson = JSON.stringify(payload);
  if (!inspectPersistableText(payloadJson).ok) throw new ScriptWriteContentRejectedError();
  return { payload, payloadJson, payloadHash: sha256(payloadJson) };
}

/** Approval previews intentionally omit creative text while binding its exact hash and length. */
export function scriptWorkspaceWritePreview(input: { payload: ScriptWorkspaceWriteInput;
  payloadHash: string; targetStateHash: string }) {
  return { kind: "workspace-field" as const, key: input.payload.key,
    contentLength: input.payload.content.length, payloadHash: input.payloadHash,
    targetStateHash: input.targetStateHash };
}

export function scriptContentWritePreview(input: { payload: ScriptContentWriteInput;
  payloadHash: string; targetStateHash: string }) {
  return { kind: "script" as const, effect: input.payload.effect,
    scriptId: input.payload.effect === "update" ? input.payload.scriptId : null,
    name: input.payload.name, contentLength: input.payload.content.length,
    payloadHash: input.payloadHash, targetStateHash: input.targetStateHash };
}
