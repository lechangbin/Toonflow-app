import assert from "node:assert/strict";
import test from "node:test";

import {
  baseExtractionToolInputSchema,
  completenessAuditToolInputSchema,
  normalizeIdentityFacts,
  parseBaseExtractionToolInput,
  parseCompletenessAuditToolInput,
} from "../src/script/assetExtractionContract";

const CANDIDATE = {
  type: "role" as const,
  canonicalName: "吴广",
  aliases: ["吴叔"],
  summary: "秦末戍卒领袖，参与大泽乡起义。",
  scriptIds: [2],
  evidence: [{ scriptId: 2, excerpt: "吴广与同伴检查误期名册木牍。", locator: "第1场" }],
};

test("preserves canonical Base Asset candidates from a strict Model", () => {
  const input = { assets: [CANDIDATE] };
  assert.deepEqual(parseBaseExtractionToolInput(input), input);
});

test("normalizes JSON-encoded candidate arrays from a compatible Model", () => {
  const result = parseBaseExtractionToolInput({ assets: JSON.stringify([CANDIDATE]) });
  assert.deepEqual(result, { assets: [CANDIDATE] });
});

test("decodes fenced JSON tool parameters", () => {
  const result = parseBaseExtractionToolInput(
    "```json\n" + JSON.stringify({ assets: [CANDIDATE] }) + "\n```",
  );
  assert.deepEqual(result, { assets: [CANDIDATE] });
});

test("bounds evidence excerpt length deterministically", () => {
  const long = "长".repeat(500);
  const result = parseBaseExtractionToolInput({
    assets: [{ ...CANDIDATE, evidence: [{ scriptId: 2, excerpt: long, locator: "第1场" }] }],
  });
  assert.equal(result.assets[0].evidence[0].excerpt.length, 200);
});

test("normalizes completeness audit output with double-encoded arrays", () => {
  const audit = {
    additions: [],
    factAdditions: [
      {
        type: "role",
        canonicalName: "胡亥",
        identityFacts: { gender: "男", invented: "推测字段" },
        evidence: [{ scriptId: 1, excerpt: "年轻的秦二世胡亥。", locator: "第1场" }],
      },
    ],
    typeCorrections: [],
    aliasProposals: [],
  };
  const result = parseCompletenessAuditToolInput({
    additions: JSON.stringify(audit.additions),
    factAdditions: JSON.stringify(audit.factAdditions),
    typeCorrections: JSON.stringify(audit.typeCorrections),
    aliasProposals: JSON.stringify(audit.aliasProposals),
  });
  assert.equal(result.factAdditions.length, 1);
  assert.deepEqual(result.factAdditions[0].identityFacts, { gender: "男", invented: "推测字段" });
});

test("strips unknown identity fact keys per asset type", () => {
  assert.deepEqual(normalizeIdentityFacts("role", { gender: "男", landmark: "x" }), { gender: "男" });
  assert.deepEqual(normalizeIdentityFacts("scene", { landmark: "亭舍", gender: "男" }), { landmark: "亭舍" });
  assert.equal(normalizeIdentityFacts("tool", { gender: "男" }), undefined);
});

test("rejects unsupported Model output with a contract error", () => {
  assert.throws(
    () => parseBaseExtractionToolInput({ assets: { not: "an-array" } }),
    /基础资产提取结果格式无效/,
  );
  assert.throws(
    () =>
      parseBaseExtractionToolInput({
        assets: [{ ...CANDIDATE, type: "location" as unknown as typeof CANDIDATE.type }],
      }),
    /基础资产提取结果格式无效/,
  );
  assert.throws(
    () => parseCompletenessAuditToolInput({ additions: [], factAdditions: [], typeCorrections: [], aliasProposals: {} }),
    /完整性审计结果格式无效/,
  );
});

test("exposes tool input schemas at the AI SDK tool-input seam", () => {
  assert.ok(baseExtractionToolInputSchema);
  assert.ok(completenessAuditToolInputSchema);
});
