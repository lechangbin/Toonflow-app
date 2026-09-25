import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime } from "../src/agentRuntime";
import type { DatabaseWork } from "../src/database";
import { createEvaluationAgentCase } from "../src/eval/evaluationAgentCase";
import { createEvaluationRunRuntime, hashEvaluationInput } from "../src/eval/evaluationRun";
import initDB from "../src/lib/initDB";

const revisionSet = { app: "app-1", schema: "schema-1", runtime: "runtime-1",
  tool: "tool-1", context: "context-1", memory: "memory-1",
  skill: "skill-1", model: "model-1", vendor: "vendor-1" };
const manifest = { schemaVersion: "toonflow.evaluation-run.v2",
  studyId: "t11-runtime-case-v1", caseManifestHash: "a".repeat(64),
  caseIds: ["DEV-EXT-001"], seeds: [11, 29],
  caseInputs: [{ caseId: "DEV-EXT-001", projectId: 7, contentHash: hashEvaluationInput("给出项目摘要"),
    role: "scriptAgent", scope: "read-only-project-guidance-v1" }],
  variants: ["baseline", "candidate"], baseline: revisionSet,
  candidate: { ...revisionSet, app: "app-2" }, frozenAt: 100 };

test("T11 adapter records a case only after the real AgentRuntime terminates", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  const previousLog = console.log;
  console.log = () => {};
  try { await initDB(db); } finally { console.log = previousLog; }
  try {
    await db("o_project").insert({ id: 7, userId: 1, name: "评测项目" });
    const queue: Array<() => Promise<void>> = [];
    let id = 0;
    let modelCalls = 0;
    const work: DatabaseWork = async (operation) => operation(db);
    const runtime = createAgentRuntime({ work,
      now: () => 200, createId: () => `runtime-${++id}`,
      schedule: (task) => queue.push(task),
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "text-v1",
        temperature: 2, maxOutputTokens: 256 },
      invokeText: async () => { modelCalls++; return { text: "局部受控建议" } as any; } }) });
    const evaluation = createEvaluationRunRuntime({ work, now: () => 200,
      createId: () => `evaluation-${++id}` });
    const created = await evaluation.create(manifest);
    const adapter = createEvaluationAgentCase({ evaluation, runtime,
      currentRevisions: async () => revisionSet,
      awaitScheduledWork: async () => { while (queue.length) await queue.shift()!(); } });
    const input = { evaluationRunId: created.id, caseId: "DEV-EXT-001", seed: 11,
      variant: "baseline" as const, projectId: 7,
      role: "scriptAgent" as const, scope: "read-only-project-guidance-v1" as const,
      content: "给出项目摘要" };
    const result = await adapter.execute(input);
    assert.equal(result.runStatus, "succeeded");
    assert.equal(modelCalls, 1);
    assert.equal((await evaluation.inspect(created.id)).recorded, 1);
    assert.deepEqual(await adapter.execute(input), result);
    assert.equal(modelCalls, 1);
    await assert.rejects(adapter.execute({ ...input, variant: "candidate" }), /revisions do not match/u);
    await assert.rejects(adapter.execute({ ...input, caseId: "HOLD-EXT-001" }), /frozen matrix/u);
    await assert.rejects(adapter.execute({ ...input, content: "另一个问题" }), /frozen input/u);
    await assert.rejects(adapter.execute({ ...input, projectId: 8 }), /frozen input/u);
    await assert.rejects(adapter.execute({ ...input, role: "productionAgent" }), /frozen input/u);
    assert.equal(modelCalls, 1);
  } finally { await db.destroy(); }
});
