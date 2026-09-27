import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { computeFinalAcceptanceEvidenceHash } from
  "../src/eval/finalAcceptanceEvidenceFiles";
import { inspectFinalAcceptanceEvidenceFiles } from
  "../src/eval/finalAcceptanceEvidenceInspection";
import { REQUIRED_ACCEPTANCE_IDS } from "../src/eval/finalAcceptanceIndex";

const manifest = { app: "app-1", web: "web-1", schema: "schema-1",
  bundle: "a".repeat(64), runtime: "runtime-1", tool: "tool-1",
  context: "context-1", memory: "memory-1", skill: "skill-1",
  topology: "topology-1", model: "model-1", vendor: "vendor-1", cases: "cases-1" };

function indexFor(hash: string, passed: number) {
  return { schemaVersion: "toonflow.final-acceptance-index.v1",
    issue: "lechangbin/Toonflow-app#77", revisionManifest: manifest,
    items: REQUIRED_ACCEPTANCE_IDS.map((id, position) => ({
      id, state: position < passed ? "passed" : "pending",
      evidenceRefs: position < passed ? ["docs/reports/result.txt"] : [],
      testCommand: position < passed ? "focused-test" : null,
      resultHash: position < passed ? hash : null,
      sourceComponent: position < passed ? "app" : null,
      sourceRevision: position < passed ? "app-1" : null,
      note: "fixture only",
    })), paidProviderCanary: { state: "not-run", reason: "not assessed" } };
}

test("T21 evidence inspection separates matching bytes from acceptance readiness", async () => {
  const root = await mkdtemp(join(tmpdir(), "toonflow-acceptance-inspect-"));
  try {
    await mkdir(join(root, "docs", "reports"), { recursive: true });
    const file = join(root, "docs", "reports", "result.txt");
    await writeFile(file, "first", "utf8");
    const hash = await computeFinalAcceptanceEvidenceHash(root, ["docs/reports/result.txt"]);
    const partial = await inspectFinalAcceptanceEvidenceFiles(indexFor(hash, 1), root);
    assert.deepEqual(partial.observations.map((entry) => entry.state), [
      "hash-match", ...Array(6).fill("not-claimed")]);
    assert.equal(partial.allClaimedHashesMatch, false);
    const completeBytes = await inspectFinalAcceptanceEvidenceFiles(indexFor(hash, 7), root);
    assert.equal(completeBytes.allClaimedHashesMatch, true);
    assert.equal(Object.hasOwn(completeBytes, "ready"), false);
    await writeFile(file, "changed", "utf8");
    const changed = await inspectFinalAcceptanceEvidenceFiles(indexFor(hash, 7), root);
    assert.deepEqual(changed.observations.map((entry) => entry.state),
      Array(7).fill("hash-mismatch"));
    assert.equal(changed.allClaimedHashesMatch, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T21 evidence inspection reports missing file without treating it as a pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "toonflow-acceptance-inspect-"));
  try {
    const result = await inspectFinalAcceptanceEvidenceFiles(indexFor("b".repeat(64), 1), root);
    assert.equal(result.observations[0].state, "unreadable");
    assert.equal(result.observations[0].observedHash, null);
    assert.equal(result.allClaimedHashesMatch, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
