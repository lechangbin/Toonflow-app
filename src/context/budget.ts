export const CONTEXT_BUDGET_POLICY_VERSION = "toonflow.context-budget.v1" as const;
export const CONTEXT_TOKEN_ESTIMATOR_VERSION = "utf8-byte-upper-bound.v1" as const;

export type ContextCategory = "authoritative" | "toolResults" | "recentInteraction" | "memory";
export type ContextRisk = "standard" | "high";

const CATEGORIES: readonly ContextCategory[] = ["authoritative", "toolResults", "recentInteraction", "memory"];
const WEIGHTS: Record<ContextRisk, readonly [number, number, number, number]> = {
  standard: [45, 20, 20, 15], high: [60, 25, 10, 5],
};

export class ContextBudgetExceededError extends Error {
  readonly code = "context_budget_exceeded";
  constructor() {
    super("Mandatory Context exceeds the model input budget");
    this.name = "ContextBudgetExceededError";
  }
}

/** Conservative plain-text estimate; the revision is part of each future Bundle manifest. */
export function estimateContextTokens(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export interface ContextBudgetInput {
  contextWindowTokens: number;
  policyMaxInputTokens: number;
  outputReserveTokens: number;
  toolProtocolReserveTokens: number;
  mandatoryTokens: number;
  risk: ContextRisk;
  optionalDemandTokens: Record<ContextCategory, number>;
}

export interface ContextBudgetPlan {
  policyVersion: typeof CONTEXT_BUDGET_POLICY_VERSION;
  estimatorVersion: typeof CONTEXT_TOKEN_ESTIMATOR_VERSION;
  risk: ContextRisk;
  safetyMarginTokens: number;
  inputBudgetTokens: number;
  mandatoryTokens: number;
  optionalBudgetTokens: number;
  baseAllocations: Record<ContextCategory, number>;
  allowedTokens: Record<ContextCategory, number>;
  unusedTokens: number;
}

function safeNonNegative(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Lower-authority unused allocation may flow upward, never the reverse. */
export function planContextBudget(input: ContextBudgetInput): ContextBudgetPlan {
  if (input.risk !== "standard" && input.risk !== "high") throw new TypeError("Context risk is invalid");
  if (![input.contextWindowTokens, input.policyMaxInputTokens, input.outputReserveTokens,
    input.toolProtocolReserveTokens, input.mandatoryTokens,
    ...CATEGORIES.map((category) => input.optionalDemandTokens[category])].every(safeNonNegative)
    || input.contextWindowTokens === 0 || input.policyMaxInputTokens === 0) {
    throw new TypeError("Context budget inputs must be non-negative safe integers");
  }
  const safetyMarginTokens = Math.max(512, Math.ceil(input.contextWindowTokens * 0.05));
  const available = input.contextWindowTokens - input.outputReserveTokens
    - input.toolProtocolReserveTokens - safetyMarginTokens;
  const inputBudgetTokens = Math.min(input.policyMaxInputTokens, available);
  if (inputBudgetTokens < 0 || input.mandatoryTokens > inputBudgetTokens) throw new ContextBudgetExceededError();
  const optionalBudgetTokens = inputBudgetTokens - input.mandatoryTokens;
  const weights = WEIGHTS[input.risk];
  const baseAllocations = {} as Record<ContextCategory, number>;
  let allocated = 0;
  for (const [index, category] of CATEGORIES.entries()) {
    const amount = index === CATEGORIES.length - 1
      ? optionalBudgetTokens - allocated : Math.floor(optionalBudgetTokens * weights[index] / 100);
    baseAllocations[category] = amount;
    allocated += amount;
  }
  const allowedTokens = {} as Record<ContextCategory, number>;
  let spill = 0;
  for (const category of [...CATEGORIES].reverse()) {
    const allowed = Math.min(input.optionalDemandTokens[category], baseAllocations[category] + spill);
    allowedTokens[category] = allowed;
    spill = baseAllocations[category] + spill - allowed;
  }
  return { policyVersion: CONTEXT_BUDGET_POLICY_VERSION,
    estimatorVersion: CONTEXT_TOKEN_ESTIMATOR_VERSION, risk: input.risk, safetyMarginTokens,
    inputBudgetTokens, mandatoryTokens: input.mandatoryTokens, optionalBudgetTokens,
    baseAllocations, allowedTokens, unusedTokens: spill };
}
