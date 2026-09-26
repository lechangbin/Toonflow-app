import { createHash } from "node:crypto";

import { stepCountIs } from "ai";

import type { ConfiguredTextCall } from "@/vendor/contract";

/** The same bounded Agnes text policy must be resolved for both Runtime roles. */
export const T11_AGNES_TEXT_POLICY = Object.freeze({ vendorId: "agnes",
  modelId: "agnes-3.0-flash", temperature: 0, maxOutputTokens: 512,
  contextWindowTokens: 524_288, maxSteps: 2 });

export const T11_AGNES_TEXT_POLICY_REVISION = createHash("sha256")
  .update(JSON.stringify(T11_AGNES_TEXT_POLICY)).digest("hex");

export function assertT11AgnesTextBinding(target: ConfiguredTextCall["target"]): void {
  for (const field of ["vendorId", "modelId", "temperature",
    "maxOutputTokens", "contextWindowTokens"] as const) {
    if (target[field] !== T11_AGNES_TEXT_POLICY[field]) {
      throw new TypeError(`T11 actual Text Model ${field} differs from frozen policy`);
    }
  }
}

/** Replaces any caller-supplied stop rule with the frozen two-step ceiling. */
export function bindT11AgnesTextCall(call: ConfiguredTextCall): ConfiguredTextCall {
  assertT11AgnesTextBinding(call.target);
  return { ...call, invokeText: (input) => call.invokeText({ ...input,
    stopWhen: stepCountIs(T11_AGNES_TEXT_POLICY.maxSteps) }) };
}
