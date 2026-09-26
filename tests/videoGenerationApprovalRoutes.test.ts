import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";

import { createVideoGenerationApprovalRouter } from
  "../src/routes/agentRuns/videoGenerationApproval";
import { VideoGenerationApprovalConflictError } from
  "../src/controlledTools/videoGenerationApproval";

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
    const bodyText = await response.text();
    return { status: response.status,
      body: bodyText.startsWith("{") ? JSON.parse(bodyText) as any : bodyText };
  } finally { server.close(); await once(server, "close"); }
}

function appWith(runtime: unknown, userId: number) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: userId }; next();
  });
  app.use(createVideoGenerationApprovalRouter(runtime as never));
  return app;
}

test("Video approval routes use authenticated actor and expose no dispatch endpoint", async () => {
  let seen: any;
  const runtime = { propose: async (input: unknown) => { seen = input; return { status: "pending" }; },
    inspect: async () => null, list: async () => [],
    decide: async (input: unknown) => { seen = input; return { status: "approved" }; } };
  const app = appWith(runtime, 42);
  const payload = { scriptId: 11, item: { trackId: 31, promptRevisionId: 51,
    vendorId: "agnes", modelId: "model", capabilityId: "text-to-video",
    inputs: [], output: { presetId: "720p", duration: 5,
      resolution: "720p", aspectRatio: "16:9" },
    audio: { generation: "native", enabled: true } } };
  const proposed = await post(app, "/propose", { projectId: 7,
    clientRequestId: "request", operationId: "operation", payload,
    actorUserId: 999 });
  assert.equal(proposed.status, 200);
  assert.equal(seen.actorUserId, 42);
  const decided = await post(app, "/decide", { projectId: 7,
    runId: "run", approvalId: "approval", clientCommandId: "command",
    expectedVersion: 1, decision: "approve", actorUserId: 999 });
  assert.equal(decided.status, 200);
  assert.equal(seen.actorUserId, 42);
  assert.equal((await post(app, "/execute", { projectId: 7 })).status, 404);
  assert.equal((await post(appWith(runtime, 0), "/decide", { projectId: 7,
    runId: "run", approvalId: "approval", clientCommandId: "command",
    expectedVersion: 1, decision: "approve" })).status, 403);
});

test("Video approval route reports stale decision as conflict", async () => {
  const runtime = { propose: async () => null, inspect: async () => null,
    list: async () => [], decide: async () => {
      throw new VideoGenerationApprovalConflictError();
    } };
  assert.equal((await post(appWith(runtime, 42), "/decide", { projectId: 7,
    runId: "run", approvalId: "approval", clientCommandId: "command",
    expectedVersion: 1, decision: "approve" })).status, 409);
});
