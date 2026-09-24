import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";

import { StoryboardApprovalConflictError } from
  "../src/controlledTools/storyboardWriteApproval";
import { createStoryboardWriteApprovalRouter } from
  "../src/routes/agentRuns/storyboardWriteApproval";

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

test("Storyboard routes derive Owner from authenticated request and map conflict", async () => {
  const calls: unknown[] = [];
  let conflict = false;
  const runtime = {
    propose: async (input: unknown) => { calls.push(input); return { id: "approval-1" }; },
    inspect: async () => ({ id: "approval-1" }),
    decide: async (input: unknown) => {
      calls.push(input);
      if (conflict) throw new StoryboardApprovalConflictError();
      return { id: "approval-1", status: "approved" };
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: 42 };
    next();
  });
  app.use(createStoryboardWriteApprovalRouter(runtime as never));
  const proposed = await post(app, "/propose", { projectId: 7,
    clientRequestId: "request-1", operationId: "operation-1",
    payload: {}, actorUserId: 999 });
  assert.equal(proposed.status, 200);
  assert.equal((calls[0] as { actorUserId: number }).actorUserId, 42);
  const body = { projectId: 7, runId: "run-1", approvalId: "approval-1",
    clientCommandId: "command-1", expectedVersion: 1,
    decision: "approve", actorUserId: 999 };
  assert.equal((await post(app, "/decide", body)).status, 200);
  assert.equal((calls[1] as { actorUserId: number }).actorUserId, 42);
  conflict = true;
  const stale = await post(app, "/decide", body);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.reason, "conflict");
});
