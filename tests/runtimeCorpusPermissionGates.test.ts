import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { inspectRuntimeReceiptPermissionDecisions } from "../src/eval/runtimeCorpusGateVerifier";

const receipt = { operationId: "read-1", toolName: "get_script_workspace",
  status: "succeeded" };
const decision = (allowed: boolean) => {
  const decisionJson = JSON.stringify({ allowed });
  return { operationId: receipt.operationId, toolName: receipt.toolName,
    decisionJson, decisionHash: createHash("sha256").update(decisionJson).digest("hex") };
};

test("T11 harness read requires a matching allowed Skill decision", () => {
  assert.deepEqual(inspectRuntimeReceiptPermissionDecisions(
    "script-harness-guidance-v1", [receipt], []), ["tool-permission-decision-missing"]);
  assert.deepEqual(inspectRuntimeReceiptPermissionDecisions(
    "script-harness-guidance-v1", [receipt], [decision(true)]), []);
  assert.deepEqual(inspectRuntimeReceiptPermissionDecisions(
    "script-harness-guidance-v1", [receipt], [decision(false)]),
  ["tool-with-denied-permission"]);
  assert.deepEqual(inspectRuntimeReceiptPermissionDecisions(
    "read-only-project-guidance-v1", [receipt], []), []);
});

test("T11 Skill decision mismatch, tampering, and duplicate operation fail closed", () => {
  const allowed = decision(true);
  assert.deepEqual(inspectRuntimeReceiptPermissionDecisions(
    "production-harness-v1", [receipt], [{ ...allowed, toolName: "get_novel_text" }]),
  ["tool-permission-decision-mismatch"]);
  assert.deepEqual(inspectRuntimeReceiptPermissionDecisions(
    "production-harness-v1", [receipt], [{ ...allowed, decisionHash: "0".repeat(64) }]),
  ["permission-decision-corrupt"]);
  assert.deepEqual(inspectRuntimeReceiptPermissionDecisions(
    "production-harness-v1", [receipt], [allowed, allowed]),
  ["permission-decision-duplicate"]);
  assert.deepEqual(inspectRuntimeReceiptPermissionDecisions(
    "production-harness-v1", [], [{ ...allowed, decisionHash: "0".repeat(64) }]),
  ["permission-decision-corrupt"]);
});
