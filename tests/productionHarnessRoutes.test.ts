import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";

import type { AgentRuntime } from "../src/agentRuntime";
import { createProductionHarnessRouter } from "../src/routes/agentRuns/productionHarness";

test("Production transport derives actor from authentication and cannot cancel another scope", async () => {
  let startInput: unknown;
  let effectsInput: unknown;
  let cancelCalls = 0;
  const runtime = { start: async (input: unknown) => {
    startInput = input;
    return { id: "production-one", projectId: 7, role: "productionAgent",
      scope: "production-harness-v1", status: "queued", version: 1,
      allowedActions: ["inspect", "cancel"], outputs: [], createdAt: 100 };
  }, inspect: async () => ({ id: "script-one", scope: "script-harness-guidance-v1" }),
  cancel: async () => { cancelCalls++; return null; } } as unknown as AgentRuntime;
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: 5 };
    next();
  }, createProductionHarnessRouter(runtime, async (input) => {
    effectsInput = input;
    return { runId: input.runId, effects: [], derivedEffects: [] };
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const post = (path: string, body: unknown) => fetch(
      `http://127.0.0.1:${address.port}${path}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body) });
    assert.equal((await post("/start", { schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "productionAgent", scope: "production-harness-v1",
      clientRequestId: "one", content: "只读检查", actorUserId: 99 })).status, 200);
    assert.deepEqual(startInput, { schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "productionAgent", scope: "production-harness-v1",
      clientRequestId: "one", content: "只读检查", actorUserId: 5 });
    assert.equal((await post("/cancel", { projectId: 7, runId: "script-one",
      clientCommandId: "cancel-other-scope", expectedVersion: 1 })).status, 404);
    assert.equal(cancelCalls, 0);
    assert.equal((await post("/effects", { projectId: 7, runId: "production-one",
      actorUserId: 99 })).status, 200);
    assert.deepEqual(effectsInput, { projectId: 7,
      runId: "production-one", actorUserId: 5 });
  } finally { server.close(); await once(server, "close"); }
});
