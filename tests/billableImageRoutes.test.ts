import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";

import { BillableImageLedgerConflictError } from "../src/controlledTools/billableImageLedger";
import { createBillableImageRouter } from "../src/routes/agentRuns/billableImage";

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

function appWith(fake: unknown, userId = 42) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: userId }; next();
  });
  app.use(createBillableImageRouter(fake as never));
  return app;
}

test("billable image HTTP flow uses authenticated actor and persisted scope, not browser scope", async () => {
  let decideInput: any;
  let executeInput: any;
  const scope = { projectId: 7, assetId: 9, vendorId: "vendor", modelId: "model",
    resolution: "1K", maxCalls: 1, estimatedMaxCostMicros: 200_000, currency: "USD" };
  const fake = {
    quotePolicy: { get: async () => null, set: async () => null },
    approval: { propose: async () => null, list: async () => [], inspect: async () => null,
      decide: async (input: unknown) => { decideInput = input; return { id: "approval" }; },
      approvedScope: async () => scope },
    execute: async (input: unknown) => { executeInput = input; return { status: "unknown", requestId: "request" }; },
    ledger: { requestCancellation: async () => undefined, stopWithoutReplay: async () => undefined },
    commit: { commit: async () => null },
    artifact: { inspect: async () => null, recoverPending: async () => null },
  };
  const app = appWith(fake);
  const decided = await post(app, "/decide", { projectId: 7, runId: "run", approvalId: "approval",
    clientCommandId: "command", expectedVersion: 1, decision: "approve", actorUserId: 999 });
  assert.equal(decided.status, 200);
  assert.equal(decideInput.actorUserId, 42);
  const executed = await post(app, "/execute", { projectId: 7, runId: "run", approvalId: "approval",
    expectedVersion: 2, actorUserId: 999, scope: { ...scope, estimatedMaxCostMicros: 1 } });
  assert.equal(executed.status, 200);
  assert.equal(executed.body.data.result.status, "unknown");
  assert.equal(executeInput.actorUserId, 42);
  assert.deepEqual(executeInput.scope, scope);
});

test("billable image HTTP flow rejects missing actor and stale commands", async () => {
  const fake = { quotePolicy: { get: async () => null, set: async () => null },
    approval: { propose: async () => null, list: async () => [], inspect: async () => null,
      decide: async () => { throw new BillableImageLedgerConflictError(); },
      approvedScope: async () => { throw new BillableImageLedgerConflictError(); } },
    execute: async () => { throw new Error("must not execute"); },
    ledger: { requestCancellation: async () => undefined,
      stopWithoutReplay: async () => { throw new BillableImageLedgerConflictError(); } },
    commit: { commit: async () => { throw new BillableImageLedgerConflictError(); } },
    artifact: { inspect: async () => null,
      recoverPending: async () => { throw new BillableImageLedgerConflictError(); } } };
  const body = { projectId: 7, runId: "run", approvalId: "approval",
    clientCommandId: "command", expectedVersion: 1, decision: "approve" };
  assert.equal((await post(appWith(fake, 0), "/decide", body)).status, 403);
  assert.equal((await post(appWith(fake), "/decide", body)).status, 409);
  assert.equal((await post(appWith(fake), "/execute", body)).status, 409);
  assert.equal((await post(appWith(fake), "/commit", { projectId: 7,
    requestId: "request", expectedVersion: 2 })).status, 409);
  assert.equal((await post(appWith(fake), "/stop", { projectId: 7,
    requestId: "request", expectedVersion: 2 })).status, 409);
  assert.equal((await post(appWith(fake), "/artifact/recover", { projectId: 7,
    requestId: "request" })).status, 409);
});

test("observed-artifact commit endpoint always uses the authenticated actor", async () => {
  let received: any;
  const fake = { quotePolicy: { get: async () => null, set: async () => null },
    approval: { propose: async () => null, list: async () => [], inspect: async () => null,
      decide: async () => null, approvedScope: async () => null }, execute: async () => null,
    ledger: { requestCancellation: async () => undefined, stopWithoutReplay: async () => undefined },
    commit: { commit: async (input: unknown) => { received = input; return { assetId: 9, imageId: 3 }; } },
    artifact: { inspect: async () => null, recoverPending: async () => null } };
  const result = await post(appWith(fake), "/commit", { projectId: 7,
    requestId: "request", expectedVersion: 2, actorUserId: 999 });
  assert.equal(result.status, 200);
  assert.equal(received.actorUserId, 42);
});
