import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";

import { VideoRequestLedgerConflictError } from
  "../src/controlledTools/videoRequestLedger";
import { createVideoGenerationExecutionRouter } from
  "../src/routes/agentRuns/videoGenerationExecution";

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
    return { status: response.status, body: await response.text() };
  } finally { server.close(); await once(server, "close"); }
}

function appWith(runtime: unknown, userId: number, enabled: boolean) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: userId }; next();
  });
  app.use(createVideoGenerationExecutionRouter(runtime as never, () => enabled));
  return app;
}

test("controlled Video execute is disabled by default and never calls the runtime", async () => {
  let calls = 0;
  const runtime = { execution: { execute: async () => { calls += 1; } } };
  const result = await post(appWith(runtime, 1, false), "/execute", {
    projectId: 7, runId: "run-7", approvalId: "approval-7",
    expectedVersion: 2 });
  assert.equal(result.status, 404);
  assert.equal(calls, 0);
});

test("controlled Video commands take actor from authentication, not request body", async () => {
  const seen: Array<{ actorUserId: number }> = [];
  const record = async (input: { actorUserId: number }) => { seen.push(input); };
  const runtime = {
    execution: { execute: async (input: { actorUserId: number }) => {
      await record(input); return { status: "submission-unknown" };
    } },
    ledger: { requestCancellation: record, stopWithoutReplay: record },
    commit: { commit: async (input: { actorUserId: number }) => {
      await record(input); return { videoId: 9 };
    } },
    artifact: { recoverPending: async (_projectId: number,
      actorUserId: number) => { seen.push({ actorUserId }); return { status: "observed" }; } },
  };
  const app = appWith(runtime, 42, true);
  const target = { projectId: 7, requestId: "request-7",
    expectedVersion: 3, actorUserId: 999 };
  assert.equal((await post(app, "/execute", { ...target,
    runId: "run-7", approvalId: "approval-7" })).status, 200);
  assert.equal((await post(app, "/cancel", target)).status, 200);
  assert.equal((await post(app, "/stop", target)).status, 200);
  assert.equal((await post(app, "/commit", target)).status, 200);
  assert.equal((await post(app, "/artifact/recover", target)).status, 200);
  assert.deepEqual(seen.map((input) => input.actorUserId), [42, 42, 42, 42, 42]);
  assert.equal((await post(appWith(runtime, 0, true), "/execute", {
    projectId: 7, runId: "run-7", approvalId: "approval-7",
    expectedVersion: 2 })).status, 403);
});

test("controlled Video stale operation returns conflict without retry", async () => {
  let calls = 0;
  const runtime = { execution: { execute: async () => {
    calls += 1; throw new VideoRequestLedgerConflictError();
  } } };
  const result = await post(appWith(runtime, 1, true), "/execute", {
    projectId: 7, runId: "run-7", approvalId: "approval-7",
    expectedVersion: 2 });
  assert.equal(result.status, 409);
  assert.equal(calls, 1);
});
