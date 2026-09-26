import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";

import type { AgentRunSnapshot, AgentRuntime } from "../src/agentRuntime";
import { createScriptHarnessControlsRouter } from "../src/routes/agentRuns/scriptHarnessControls";
import { createStartScriptHarnessRouter } from "../src/routes/agentRuns/startScriptHarness";

const run = { id: "harness-run", projectId: 7, role: "scriptAgent",
  scope: "script-harness-guidance-v1", clientRequestId: "request-1",
  requestFingerprint: "fingerprint", status: "queued", allowedActions: ["inspect"],
  leaseFence: 0, version: 1, createdAt: 100, updatedAt: 100,
  steps: [], attempts: [], checkpoints: [], outputs: [], traces: [],
  traceEvidence: { schemaVersion: "toonflow.trace-timeline-evidence.v1",
    ordering: "durable-sequence", linkage: "legacy-unlinked", eventCount: 0 } } as AgentRunSnapshot;

async function post(app: express.Express, path: string, body: unknown) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  } finally { server.close(); await once(server, "close"); }
}

test("Script Harness routes derive actor from JWT middleware and keep a distinct versioned scope", async () => {
  let started: unknown;
  let inspected: unknown;
  let cancelled: unknown;
  const runtime: AgentRuntime = {
    start: async (input) => { started = input; return run; },
    inspect: async (input) => { inspected = input; return run; },
    cancel: async (input) => { cancelled = input; return run; },
    list: async () => ({ current: run, recent: [run] }),
  };
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: 5 };
    next();
  });
  app.use("/start", createStartScriptHarnessRouter(runtime));
  app.use("/control", createScriptHarnessControlsRouter(runtime));
  const input = { schemaVersion: "toonflow.agent-run.start.v1", projectId: 7,
    role: "scriptAgent", scope: "script-harness-guidance-v1",
    clientRequestId: "request-1", content: "分析章节", actorUserId: 99 };
  assert.equal((await post(app, "/start", input)).status, 200);
  assert.deepEqual(started, { ...input, actorUserId: 5 });
  assert.equal((await post(app, "/start", { ...input,
    scope: "read-only-project-guidance-v1" })).status, 400);
  assert.equal((await post(app, "/control/inspect", { projectId: 7,
    runId: run.id })).status, 200);
  assert.deepEqual(inspected, { projectId: 7, runId: run.id, actorUserId: 5 });
  assert.equal((await post(app, "/control/list", { projectId: 7,
    role: "scriptAgent", scope: "script-harness-guidance-v1" })).status, 200);
  assert.equal((await post(app, "/control/cancel", { projectId: 7,
    runId: run.id, clientCommandId: "stop-1", expectedVersion: 1 })).status, 200);
  assert.deepEqual(cancelled, { projectId: 7, runId: run.id,
    clientCommandId: "stop-1", expectedVersion: 1, actorUserId: 5 });
});
