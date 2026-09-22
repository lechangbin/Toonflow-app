import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";

import type { AgentRunSnapshot, AgentRuntime } from "../src/agentRuntime";
import { AgentRunContentRejectedError } from "../src/agentRuntime";
import { createInspectAgentRunRouter } from "../src/routes/agentRuns/inspect";
import { createStartAgentRunRouter } from "../src/routes/agentRuns/start";

const run: AgentRunSnapshot = {
  id: "run-1",
  projectId: 7,
  role: "scriptAgent",
  scope: "read-only-project-guidance-v1",
  clientRequestId: "request-1",
  requestFingerprint: "fingerprint",
  status: "queued",
  allowedActions: ["inspect"],
  version: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  steps: [],
  attempts: [],
  checkpoints: [],
  outputs: [],
  traces: [],
};

async function post(app: express.Express, path: string, body: unknown) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("start route validates the versioned fixed scope and returns its durable UI projection", async () => {
  let received: unknown;
  const runtime: AgentRuntime = {
    start: async (input) => { received = input; return run; },
    inspect: async () => null,
  };
  const app = express();
  app.use(express.json(), createStartAgentRunRouter(runtime));
  const input = {
    schemaVersion: "toonflow.agent-run.start.v1",
    projectId: 7,
    role: "scriptAgent",
    scope: "read-only-project-guidance-v1",
    clientRequestId: "request-1",
    content: "只读分析",
  };
  const response = await post(app, "/", input);
  assert.equal(response.status, 200);
  assert.deepEqual(received, input);
  assert.equal(response.body.data.run.id, "run-1");
  assert.equal(response.body.data.message.id, "run-1");

  const invalid = await post(app, "/", { ...input, scope: "arbitrary" });
  assert.equal(invalid.status, 400);
});

test("inspect route is a thin project-scoped read adapter", async () => {
  let received: unknown;
  const runtime: AgentRuntime = {
    start: async () => run,
    inspect: async (input) => { received = input; return input.projectId === 7 ? run : null; },
  };
  const app = express();
  app.use(express.json(), createInspectAgentRunRouter(runtime));
  const response = await post(app, "/", { runId: "run-1", projectId: 7 });
  assert.equal(response.status, 200);
  assert.deepEqual(received, { runId: "run-1", projectId: 7 });
  assert.equal(response.body.data.message.ext.agentRun.version, 1);

  const missing = await post(app, "/", { runId: "run-1", projectId: 8 });
  assert.equal(missing.status, 404);
});

test("start route exposes a stable rejection without echoing sensitive content", async () => {
  const runtime: AgentRuntime = {
    start: async () => { throw new AgentRunContentRejectedError(["secretValue"]); },
    inspect: async () => null,
  };
  const app = express();
  app.use(express.json(), createStartAgentRunRouter(runtime));
  const response = await post(app, "/", {
    schemaVersion: "toonflow.agent-run.start.v1",
    projectId: 7,
    role: "scriptAgent",
    scope: "read-only-project-guidance-v1",
    clientRequestId: "request-secret",
    content: "sensitive but syntactically valid",
  });
  assert.equal(response.status, 422);
  assert.deepEqual(response.body.violationCodes, ["secretValue"]);
  assert.equal(JSON.stringify(response.body).includes("sensitive but syntactically valid"), false);
});
