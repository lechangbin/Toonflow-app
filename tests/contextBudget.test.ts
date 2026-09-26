import assert from "node:assert/strict";
import test from "node:test";

import { ContextBudgetExceededError, estimateContextTokens, planContextBudget,
  type ContextBudgetInput } from "../src/context/budget";

const base: ContextBudgetInput = {
  contextWindowTokens: 10_000, policyMaxInputTokens: 8_000,
  outputReserveTokens: 1_000, toolProtocolReserveTokens: 500,
  mandatoryTokens: 1_000, risk: "standard",
  optionalDemandTokens: { authoritative: 10_000, toolResults: 10_000,
    recentInteraction: 10_000, memory: 10_000 },
};

test("model-aware input ceiling and standard/high-risk allocation preserve mandatory Context", () => {
  const standard = planContextBudget(base);
  assert.equal(standard.safetyMarginTokens, 512);
  assert.equal(standard.inputBudgetTokens, 7_988);
  assert.equal(standard.optionalBudgetTokens, 6_988);
  assert.deepEqual(standard.baseAllocations, { authoritative: 3_144, toolResults: 1_397,
    recentInteraction: 1_397, memory: 1_050 });
  const high = planContextBudget({ ...base, risk: "high" });
  assert.deepEqual(high.baseAllocations, { authoritative: 4_192, toolResults: 1_747,
    recentInteraction: 698, memory: 351 });
  const constrained = planContextBudget({ ...base, policyMaxInputTokens: 9_000 });
  assert.equal(constrained.inputBudgetTokens, 7_988);
});

test("unused low-authority allocation flows upward but high-authority spare never funds Memory", () => {
  const plan = planContextBudget({ ...base, optionalDemandTokens: {
    authoritative: 4_500, toolResults: 1_000, recentInteraction: 100, memory: 0,
  } });
  assert.equal(plan.allowedTokens.authoritative, 4_500);
  assert.equal(plan.allowedTokens.toolResults, 1_000);
  assert.equal(plan.allowedTokens.recentInteraction, 100);
  assert.equal(plan.unusedTokens, 1_388);
  const noDownward = planContextBudget({ ...base, optionalDemandTokens: {
    authoritative: 0, toolResults: 0, recentInteraction: 0, memory: 7_000,
  } });
  assert.equal(noDownward.allowedTokens.memory, 1_050);
  assert.equal(noDownward.unusedTokens, 5_938);
});

test("mandatory overflow and invalid capacity fail before any Model call", () => {
  assert.throws(() => planContextBudget({ ...base, mandatoryTokens: 8_001 }), ContextBudgetExceededError);
  assert.throws(() => planContextBudget({ ...base, contextWindowTokens: 1_000,
    outputReserveTokens: 600 }), ContextBudgetExceededError);
  assert.throws(() => planContextBudget({ ...base, optionalDemandTokens: {
    ...base.optionalDemandTokens, memory: -1,
  } }), /non-negative safe integers/);
  assert.equal(estimateContextTokens("中文 A"), Buffer.byteLength("中文 A", "utf8"));
});
