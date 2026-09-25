import assert from "node:assert/strict";
import test from "node:test";

import { assessFinalAcceptance, REQUIRED_ACCEPTANCE_IDS,
  validateFinalAcceptanceIndex } from "../src/eval/finalAcceptanceIndex";

const pending = { schemaVersion: "toonflow.final-acceptance-index.v1",
  issue: "lechangbin/Toonflow-app#77", revisionManifest: null,
  items: REQUIRED_ACCEPTANCE_IDS.map((id) => ({ id, state: "pending",
    evidenceRefs: [], testCommand: null, resultHash: null,
    sourceRevision: null, note: "待最终阶段执行" })),
  paidProviderCanary: { state: "not-run", reason: "尚未进行付费 Provider canary" } };

test("T21 evidence index treats every final acceptance category as pending by default", () => {
  assert.deepEqual(assessFinalAcceptance(pending), { ready: false,
    pending: [...REQUIRED_ACCEPTANCE_IDS], failed: [],
    paidProviderCanaryGap: true });
  assert.equal(validateFinalAcceptanceIndex(pending).items.length, 7);
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
