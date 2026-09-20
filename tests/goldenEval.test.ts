import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GOLDEN_EVAL_RUNNER_VERSION,
  findSensitiveGoldenArtifacts,
  findUndeclaredGoldenArtifacts,
  finalizeGoldenCaseObservation,
  hashGoldenEvalManifest,
  loadGoldenEvalManifest,
  runGoldenEval,
  summarizeGoldenExecutionCounts,
  validateGoldenEvalManifest,
} from "../src/eval/goldenEval";
import { createGoldenScenarioEnvironment } from "../src/eval/goldenEvalScenarios";

const MANIFEST_PATH = path.resolve(
  process.cwd(),
  "data",
  "eval",
  "agent-harness-golden-v1",
  "manifest.json",
);
const BASELINE_PATH = path.resolve(
  process.cwd(),
  "docs",
  "reports",
  "data",
  "agent-harness-golden-v1-results.json",
);

test("Golden Eval manifest freezes exactly 12 development, 3 holdout, and 3 incident cases", () => {
  const manifest = loadGoldenEvalManifest(MANIFEST_PATH);
  const validated = validateGoldenEvalManifest(manifest);
  assert.equal(validated.cases.length, 18);
  assert.deepEqual(
    Object.fromEntries(
      ["development", "holdout", "incident-regression"].map((partition) => [
        partition,
        validated.cases.filter((entry) => entry.partition === partition).length,
      ]),
    ),
    { development: 12, holdout: 3, "incident-regression": 3 },
  );
  assert.equal(new Set(validated.cases.map((entry) => entry.id)).size, 18);
  for (const entry of validated.cases) {
    assert.ok(entry.fixtureSources.length > 0, `${entry.id} fixture sources`);
    assert.ok(entry.groundTruth.length > 0, `${entry.id} ground truth`);
    assert.ok(entry.hardGates.length > 0, `${entry.id} hard gates`);
    assert.ok(entry.requiredArtifacts.length > 0, `${entry.id} required artifacts`);
    assert.ok(entry.expectedFailureClass.primary.length > 0, `${entry.id} expected failure class`);
    assert.deepEqual(entry.rubric.anchors.map((anchor) => anchor.score), [0, 1, 2]);
  }
});

test("Golden Eval executes deterministically with temporary SQLite and local fake adapters", async () => {
  const first = await runGoldenEval({ manifestPath: MANIFEST_PATH });
  const second = await runGoldenEval({ manifestPath: MANIFEST_PATH });

  assert.equal(first.runnerVersion, GOLDEN_EVAL_RUNNER_VERSION);
  assert.equal(first.summary.executed, 18);
  assert.equal(first.summary.hardGate.passed, 18);
  assert.equal(first.summary.hardGate.failed, 0);
  assert.deepEqual(first.summary.executions, { valid: 18, invalid: 0, missing: 0, denominator: 18 });
  assert.deepEqual(first.summary.partitions, {
    development: { passed: 12, failed: 0, denominator: 12 },
    holdout: { passed: 3, failed: 0, denominator: 3 },
    "incident-regression": { passed: 3, failed: 0, denominator: 3 },
  });
  assert.equal(first.summary.quality.reviewed, 0);
  assert.equal(first.summary.quality.pending, 18);
  assert.equal("compositeScore" in first.summary, false);
  assert.ok(first.environment.temporarySqlite);
  assert.equal(first.environment.modelAdapter, "deterministic-fake");
  assert.equal(first.environment.vendorAdapter, "deterministic-fake");
  assert.equal(first.environment.paidProviderCalls, 0);
  assert.deepEqual(first, second);
});

test("checked-in raw baseline is the byte-stable Runner result", async () => {
  const actual = await runGoldenEval({ manifestPath: MANIFEST_PATH });
  const checkedIn = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  assert.deepEqual(checkedIn, actual);
});

test("manifest validation rejects partition drift before executing a case", () => {
  const manifest = loadGoldenEvalManifest(MANIFEST_PATH);
  const broken = structuredClone(manifest);
  broken.cases = broken.cases.slice(1);
  assert.throws(() => validateGoldenEvalManifest(broken), /exactly 18 cases/);
});

test("manifest identity is stable across LF and CRLF checkouts", () => {
  const lf = fs.readFileSync(MANIFEST_PATH, "utf8").replace(/\r\n/g, "\n");
  const crlf = lf.replace(/\n/g, "\r\n");
  assert.equal(hashGoldenEvalManifest(lf), hashGoldenEvalManifest(crlf));
});

test("manifest validation rejects missing top-level evidence identity", () => {
  const requiredFields = ["suiteId", "baselineRevision", "executionTier", "qualityRubricVersion"] as const;
  for (const field of requiredFields) {
    const broken = structuredClone(loadGoldenEvalManifest(MANIFEST_PATH)) as unknown as Record<string, unknown>;
    delete broken[field];
    assert.throws(() => validateGoldenEvalManifest(broken), new RegExp(field));
  }
});

test("failed scenario database initialization cleans its handle and temporary directory", async () => {
  const prefix = "toonflow-golden-cleanup-probe-";
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith(prefix)));
  await assert.rejects(
    () =>
      createGoldenScenarioEnvironment("CLEANUP-PROBE", async () => {
        throw new Error("forced initializer failure");
      }),
    /forced initializer failure/,
  );
  const after = fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith(prefix) && !before.has(entry));
  assert.deepEqual(after, []);
});

test("evaluation export boundary rejects nested secrets, payloads, and signed URLs", () => {
  const findings = findSensitiveGoldenArtifacts({
    safe: { digest: "a".repeat(64), requestId: "request-123" },
    nested: [
      { apiKey: "must-not-persist" },
      { image: "A".repeat(100) },
      { url: "https://vendor.invalid/image.png?signature=secret&expires=1" },
      { providerPayload: { arbitrary: "body" } },
      { hiddenReasoning: "private chain" },
      { wrapped: ("A".repeat(76) + "\n").repeat(3) },
      { binary: Buffer.from("raw-provider-bytes") },
    ],
  });
  assert.deepEqual(findings, [
    "artifacts.[key:1][0].[sensitive-key:0]",
    "artifacts.[key:1][1].[key:0]",
    "artifacts.[key:1][2].[key:0]",
    "artifacts.[key:1][3].[sensitive-key:0]",
    "artifacts.[key:1][4].[sensitive-key:0]",
    "artifacts.[key:1][5].[key:0]",
    "artifacts.[key:1][6].[key:0]",
  ]);
  assert.deepEqual(findSensitiveGoldenArtifacts({ digest: "a".repeat(64), requestId: "request-123" }), []);
  const disguisedProvider = { upstreamReply: { detail: "private provider text" } };
  const disguisedFindings = findSensitiveGoldenArtifacts({ evidence: disguisedProvider });
  assert.ok(disguisedFindings.length > 0);
  assert.equal(JSON.stringify(disguisedFindings).includes("upstreamReply"), false);
  assert.equal(JSON.stringify(disguisedFindings).includes("private provider text"), false);
  assert.deepEqual(findSensitiveGoldenArtifacts({ evidence: { prompt: null, filePath: null } }), []);
  assert.ok(findSensitiveGoldenArtifacts({ evidence: { prompt: "private script body" } }).length > 0);
  assert.ok(findSensitiveGoldenArtifacts({ evidence: { filePath: "C:/Users/private/story.txt" } }).length > 0);
  assert.ok(
    findSensitiveGoldenArtifacts({ evidence: { value: "prefix data:image/png;base64," + "A".repeat(100) } }).length > 0,
  );
  assert.ok(findSensitiveGoldenArtifacts({ evidence: { value: " data:text/plain;base64,c2VjcmV0" } }).length > 0);
  assert.deepEqual(
    findSensitiveGoldenArtifacts({ rawResponse: {}, providerResponse: {}, vendorResult: {} }),
    [
      "artifacts.[sensitive-key:0]",
      "artifacts.[sensitive-key:1]",
      "artifacts.[sensitive-key:2]",
    ],
  );
  assert.deepEqual(
    findUndeclaredGoldenArtifacts({ failureKind: "safe", rawResponse: {} }, ["failureKind"]),
    ["artifacts.[undeclared-key:1]"],
  );
  const secretInKey = "apiKey-sk-live-SECRET123";
  const keyFindings = findSensitiveGoldenArtifacts({ nested: { [secretInKey]: "x" } });
  assert.deepEqual(keyFindings, ["artifacts.[key:0].[sensitive-key:0]"]);
  assert.equal(JSON.stringify(keyFindings).includes(secretInKey), false);

  const unknownSecretKey = "sk-live-9x8y7z6w5v4u3";
  const indirectFindings = findSensitiveGoldenArtifacts({ evidence: { [unknownSecretKey]: "A".repeat(100) } });
  assert.deepEqual(indirectFindings, ["artifacts.[key:0].[key:0]"]);
  assert.equal(JSON.stringify(indirectFindings).includes(unknownSecretKey), false);
});

test("runner errors remain a single Runner-owned failure classification", () => {
  const finalized = finalizeGoldenCaseObservation({
    hardGateDefinitions: [{ id: "behavior", statement: "Behavior is correct" }],
    requiredArtifacts: ["evidence"],
    gates: {},
    artifacts: {},
    runnerError: "Error",
  });
  assert.deepEqual(finalized.artifacts, {});
  assert.deepEqual(finalized.failures, [
    { primary: "Artifact", stage: "evaluation", kind: "runnerError" },
  ]);
  assert.equal(finalized.hardGates.every((gate) => !gate.passed), true);
});

test("execution summary separates valid, invalid, and missing denominators", () => {
  assert.deepEqual(
    summarizeGoldenExecutionCounts(
      [
        { failures: [] },
        { failures: [{ kind: "runnerError" }] },
        { failures: [{ kind: "evidenceIncomplete" }] },
      ],
      4,
    ),
    { valid: 1, invalid: 2, missing: 1, denominator: 4 },
  );
});
