import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";

import { DerivedAssetCommandConflictError } from "../src/controlledTools/derivedAssetWrite";
import { createDerivedAssetApprovalRouter } from "../src/routes/agentRuns/derivedAssetApproval";

async function post(app: express.Express, path: string, body: unknown) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  } finally { server.close(); await once(server, "close"); }
}

test("approval route takes actor identity from authenticated request and maps stale versions to 409", async () => {
  let received: unknown;
  let conflict = false;
  const fake = {
    propose: async () => null,
    inspect: async () => null,
    list: async () => [],
    decide: async (input: unknown) => {
      received = input;
      if (conflict) throw new DerivedAssetCommandConflictError();
      return { id: "approval-1", runId: "run-1", status: "approved" };
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as typeof req & { user: { id: number } }).user = { id: 42 }; next(); });
  app.use(createDerivedAssetApprovalRouter(fake as never));
  const body = { projectId: 7, runId: "run-1", approvalId: "approval-1",
    clientCommandId: "command-1", expectedVersion: 1, decision: "approve", actorUserId: 999 };
  const approved = await post(app, "/decide", body);
  assert.equal(approved.status, 200);
  assert.equal((received as { actorUserId: number }).actorUserId, 42);
  conflict = true;
  const stale = await post(app, "/decide", body);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.reason, "conflict");
});
