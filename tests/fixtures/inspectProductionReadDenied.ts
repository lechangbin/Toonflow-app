import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataRoot = process.env.DATA_DIR;
const runId = process.env.HARNESS_RUN_ID;
if (!dataRoot || !runId || !/^[0-9a-f-]{36}$/u.test(runId)) {
  throw new TypeError("DATA_DIR and HARNESS_RUN_ID are required for the local denial fixture");
}
const db = new DatabaseSync(path.join(dataRoot, "db2.sqlite"), { readOnly: true });
try {
  const run = db.prepare("select status from o_agentRun where id = ?").get(runId) as
    { status: string } | undefined;
  assert.equal(run?.status, "succeeded", "the Run should finish after the denied Tool result");
  const decisions = db.prepare(`select decisionJson from o_agentSkillPermissionDecision
    where runId = ? and toolName = 'get_production_workspace_text'`).all(runId) as
    Array<{ decisionJson: string }>;
  assert.equal(decisions.length, 1, "one denied permission decision must be persisted");
  const decision = JSON.parse(decisions[0]!.decisionJson) as {
    allowed?: boolean; missing?: Array<{ layer: string; capability: string }> };
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.missing, [{ layer: "project", capability: "read:production-workspace" }]);
  const receipts = db.prepare("select count(*) as total from o_agentToolReceipt where runId = ?")
    .get(runId) as { total: number };
  assert.equal(receipts.total, 0, "denied Tool must not execute or persist a success receipt");
  console.log(JSON.stringify({ runId, permission: "denied-project-grant",
    permissionDecisionCount: decisions.length, toolReceiptCount: receipts.total }));
} finally {
  db.close();
}
