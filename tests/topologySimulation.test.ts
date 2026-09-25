import assert from "node:assert/strict";
import test from "node:test";

import { simulateTopology } from "../src/agentRuntime/topologySimulation";

const permissions = { planner: { toolNames: ["read_workspace"],
    skillIds: ["planner-skill"] },
  specialist: { toolNames: ["propose_candidate"],
    skillIds: ["specialist-skill"] },
  verifier: { toolNames: ["inspect_evidence"],
    skillIds: ["verifier-skill"] } };
const plan = { schemaVersion: "toonflow.topology-plan.v1", topology: "T2",
  roles: [
    { id: "planner", toolNames: ["read_workspace"],
      skillIds: ["planner-skill"], owns: ["plan"] },
    { id: "specialist", toolNames: ["propose_candidate"],
      skillIds: ["specialist-skill"], owns: ["candidate"] },
    { id: "verifier", toolNames: ["inspect_evidence"],
      skillIds: ["verifier-skill"], owns: ["verification", "final"] },
  ], handoffs: [
    { from: "planner", to: "specialist", allowedArtifactKinds: ["plan"],
      maxPayloadBytes: 2048 },
    { from: "specialist", to: "verifier", allowedArtifactKinds: ["candidate"],
      maxPayloadBytes: 2048 },
  ], stop: { maxHandoffs: 2, maxToolCalls: 3, maxWallMs: 30000 },
  aggregate: "verifier-gated", revision: "t2-experiment-v1" };
const ref = (id: string, kind: string, ownerRole: string) => ({ id, kind,
  ownerRole, contentHash: "a".repeat(64) });

test("T20 fake T2 runner validates every handoff and verifier-owned final result", async () => {
  const calls: string[] = [];
  const result = await simulateTopology({ plan, permissions,
    caseId: "DEV-EXT-001", seed: 11, contextBundleHash: "b".repeat(64),
    now: () => 100, toolPort: async (name) => { calls.push(name); return {}; },
    handlers: {
      planner: async (context) => {
        assert.equal(context.input, null);
        assert.deepEqual(context.skillIds, ["planner-skill"]);
        await context.invokeTool("read_workspace", {});
        return { artifacts: [ref("plan-1", "plan", "planner")] };
      },
      specialist: async (context) => {
        assert.equal(context.input?.artifacts[0].id, "plan-1");
        await context.invokeTool("propose_candidate", {});
        return { artifacts: [ref("candidate-1", "candidate", "specialist")] };
      },
      verifier: async (context) => {
        assert.equal(context.input?.artifacts[0].id, "candidate-1");
        await context.invokeTool("inspect_evidence", {});
        return { artifacts: [ref("verification-1", "verification", "verifier"),
          ref("final-1", "final", "verifier")] };
      },
    } });
  assert.deepEqual(calls, ["read_workspace", "propose_candidate", "inspect_evidence"]);
  assert.equal(result.handoffs.length, 2);
  assert.equal(result.finalArtifact.id, "final-1");
});

test("T20 fake runner rejects unauthorized Tool and raw handoff Artifact", async () => {
  let toolCalls = 0;
  const base = { plan, permissions, caseId: "DEV-EXT-001", seed: 11,
    contextBundleHash: "b".repeat(64), now: () => 100,
    toolPort: async () => { toolCalls++; return {}; } };
  await assert.rejects(simulateTopology({ ...base, handlers: {
    planner: async (context) => {
      await context.invokeTool("propose_candidate", {});
      return { artifacts: [ref("plan-1", "plan", "planner")] };
    },
  } }), /unauthorized/);
  assert.equal(toolCalls, 0);
  await assert.rejects(simulateTopology({ ...base, handlers: {
    planner: async () => ({ artifacts: [{ ...ref("plan-1", "plan", "planner"),
      rawPrompt: "should never cross" }] }),
  } }));
});
