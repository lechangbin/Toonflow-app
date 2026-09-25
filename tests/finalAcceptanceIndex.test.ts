import assert from "node:assert/strict";
import test from "node:test";

import { assessFinalAcceptance, REQUIRED_ACCEPTANCE_IDS,
  validateFinalAcceptanceIndex, verifyFinalAcceptance } from "../src/eval/finalAcceptanceIndex";

const pending = { schemaVersion: "toonflow.final-acceptance-index.v1",
  issue: "lechangbin/Toonflow-app#77", revisionManifest: null,
  items: REQUIRED_ACCEPTANCE_IDS.map((id) => ({ id, state: "pending",
    evidenceRefs: [], testCommand: null, resultHash: null,
    sourceRevision: null, note: "待最终阶段执行" })),
  paidProviderCanary: { state: "not-run", reason: "尚未进行付费 Provider canary" } };

test("T21 evidence index treats every final acceptance category as pending by default", () => {
  assert.deepEqual(assessFinalAcceptance(pending), { ready: false,
    pending: [...REQUIRED_ACCEPTANCE_IDS], failed: [],
    unverified: [],
    paidProviderCanaryGap: true });
  assert.equal(validateFinalAcceptanceIndex(pending).items.length, 7);
});

test("T21 filled metadata alone never completes acceptance without independent verification", async () => {
  const manifest = { app: "app-1", web: "web-1", schema: "schema-1",
    bundle: "a".repeat(64), runtime: "runtime-1", tool: "tool-1",
    context: "context-1", memory: "memory-1", skill: "skill-1",
    topology: "topology-1", model: "model-1", vendor: "vendor-1", cases: "cases-1" };
  const claimed = { ...pending, revisionManifest: manifest,
    items: pending.items.map((item) => ({ ...item, state: "passed",
      evidenceRefs: ["docs/reports/evidence.md"], testCommand: "targeted-test",
      resultHash: "b".repeat(64), sourceRevision: "app-1" })) };
  assert.equal(assessFinalAcceptance(claimed).ready, false);
  const denied = await verifyFinalAcceptance(claimed, async () => false);
  assert.equal(denied.ready, false);
  assert.equal(denied.unverified.length, REQUIRED_ACCEPTANCE_IDS.length);
  const verified = await verifyFinalAcceptance(claimed, async () => true);
  assert.equal(verified.ready, true);
  assert.deepEqual(verified.unverified, []);
  const stale = { ...claimed, items: claimed.items.map((item, index) =>
    index === 0 ? { ...item, sourceRevision: "other-app" } : item) };
  const staleResult = await verifyFinalAcceptance(stale, async () => true);
  assert.equal(staleResult.ready, false);
  assert.deepEqual(staleResult.unverified, ["functional"]);
});

test("T21 evidence index rejects pass claims without reproducible evidence", () => {
  const claimed = { ...pending, items: pending.items.map((item, index) =>
    index === 0 ? { ...item, state: "passed" } : item) };
  assert.throws(() => validateFinalAcceptanceIndex(claimed), /no reproducible evidence/);
  const unsafePath = { ...pending, items: pending.items.map((item, index) =>
    index === 0 ? { ...item, evidenceRefs: ["docs/../secrets.txt"] } : item) };
  assert.throws(() => validateFinalAcceptanceIndex(unsafePath));
  const missing = { ...pending, items: pending.items.slice(1) };
  assert.throws(() => validateFinalAcceptanceIndex(missing));
});
