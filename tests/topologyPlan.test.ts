import assert from "node:assert/strict";
import test from "node:test";

import { chooseSimplestTopology, topologyPlanHash, validateTopologyHandoff,
  validateTopologyPlan } from "../src/agentRuntime/topologyPlan";

const permissions = { planner: { toolNames: ["read_workspace"],
    skillIds: ["plan-skill"] },
  specialist: { toolNames: ["propose_image"], skillIds: ["image-skill"] },
  verifier: { toolNames: ["inspect_evidence"], skillIds: ["verify-skill"] },
  worker: { toolNames: ["read_workspace"], skillIds: ["worker-skill"] } };
const base = { schemaVersion: "toonflow.topology-plan.v1", topology: "T2",
  roles: [
    { id: "planner", toolNames: ["read_workspace"],
      skillIds: ["plan-skill"], owns: ["plan"] },
    { id: "specialist", toolNames: ["propose_image"],
      skillIds: ["image-skill"], owns: ["candidate"] },
    { id: "verifier", toolNames: ["inspect_evidence"],
      skillIds: ["verify-skill"], owns: ["verification", "final"] },
  ], handoffs: [
    { from: "planner", to: "specialist", allowedArtifactKinds: ["plan"],
      maxPayloadBytes: 2048 },
    { from: "specialist", to: "verifier", allowedArtifactKinds: ["candidate"],
      maxPayloadBytes: 2048 },
  ], stop: { maxHandoffs: 2, maxToolCalls: 6, maxWallMs: 30000 },
  aggregate: "verifier-gated", revision: "topology-t2-v1" };

test("T20 plan freezes typed T2 role permissions, ownership and handoff edges", () => {
  const plan = validateTopologyPlan(base, permissions);
  assert.equal(plan.handoffs.length, 2);
  assert.equal(topologyPlanHash(plan).length, 64);
  assert.throws(() => validateTopologyPlan({ ...base, roles: [base.roles[0],
    { ...base.roles[1], toolNames: ["read_workspace"] }, base.roles[2]] },
  permissions));
  assert.throws(() => validateTopologyPlan({ ...base, roles: [base.roles[0],
    base.roles[1], { ...base.roles[2], owns: ["candidate", "final"] }] },
  permissions));
});

test("T20 T0 and T1 use their exact simpler role and stop contracts", () => {
  const worker = { id: "worker", toolNames: ["read_workspace"],
    skillIds: ["worker-skill"], owns: ["final"] };
  const t0 = { ...base, topology: "T0", roles: [worker], handoffs: [],
    stop: { ...base.stop, maxHandoffs: 0 }, aggregate: "worker-output" };
  assert.equal(validateTopologyPlan(t0, permissions).roles.length, 1);
  const t1 = { ...base, topology: "T1",
    roles: [{ ...base.roles[0], owns: ["plan"] }, worker],
    handoffs: [base.handoffs[0] && { ...base.handoffs[0], to: "worker" }],
    stop: { ...base.stop, maxHandoffs: 1 }, aggregate: "worker-output" };
  assert.equal(validateTopologyPlan(t1, permissions).roles.length, 2);
  assert.throws(() => validateTopologyPlan({ ...t1,
    aggregate: "verifier-gated" }, permissions));
});

test("T20 handoff accepts only sender-owned hashed references under the edge limit", () => {
  const plan = validateTopologyPlan(base, permissions);
  const handoff = { schemaVersion: "toonflow.topology-handoff.v1",
    planHash: topologyPlanHash(plan), caseId: "DEV-EXT-001",
    fromRole: "planner", toRole: "specialist",
    contextBundleHash: "a".repeat(64), reasonCode: "plan-ready",
    artifacts: [{ id: "plan-1", kind: "plan", ownerRole: "planner",
      contentHash: "b".repeat(64) }] };
  assert.equal(validateTopologyHandoff(plan, handoff).artifacts[0].id, "plan-1");
  assert.throws(() => validateTopologyHandoff(plan, { ...handoff,
    artifacts: [{ ...handoff.artifacts[0], ownerRole: "specialist" }] }));
  assert.throws(() => validateTopologyHandoff(plan, { ...handoff,
    rawPrompt: "should never cross the handoff" }));
  assert.throws(() => validateTopologyHandoff(plan, { ...handoff,
    planHash: "c".repeat(64) }));
});

test("T20 metrics rank only an unverified threshold candidate under equal resources", () => {
  const baseEvidence = { caseManifestHash: "a".repeat(64),
    seedSetHash: "e".repeat(64), budgetHash: "b".repeat(64),
    resultsHash: "c".repeat(64),
    expectedRuns: 20, executedRuns: 20, repeatedSeeds: 2,
    qualityPassed: true, latencyPassed: true, costPassed: true,
    tokenPassed: true, retriesPassed: true, hardGateFailures: 0 };
  const evidence = ["T0", "T1", "T2"].map((topology) =>
    ({ ...baseEvidence, topology }));
  assert.deepEqual(chooseSimplestTopology(evidence),
    { state: "unverified", topology: null, thresholdCandidate: "T0" });
  assert.deepEqual(chooseSimplestTopology([{ ...evidence[0],
    qualityPassed: false }, evidence[1], evidence[2]]),
  { state: "unverified", topology: null, thresholdCandidate: "T1" });
  assert.deepEqual(chooseSimplestTopology([evidence[0],
    { ...evidence[1], budgetHash: "d".repeat(64) }, evidence[2]]),
  { state: "incomplete", topology: null, thresholdCandidate: null });
  assert.deepEqual(chooseSimplestTopology([evidence[0],
    { ...evidence[1], seedSetHash: "d".repeat(64) }, evidence[2]]),
  { state: "incomplete", topology: null, thresholdCandidate: null });
  assert.deepEqual(chooseSimplestTopology([evidence[0],
    { ...evidence[1], hardGateFailures: 1 },
    { ...evidence[2], executedRuns: 19 }]),
  { state: "incomplete", topology: null, thresholdCandidate: null });
});
