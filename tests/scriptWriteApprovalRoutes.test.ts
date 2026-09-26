import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";

import type { createScriptWriteApprovalRuntime } from "../src/controlledTools/scriptWriteApproval";
import { createScriptWriteApprovalsRouter } from "../src/routes/agentRuns/scriptWriteApprovals";

type Runtime = ReturnType<typeof createScriptWriteApprovalRuntime>;

test("Script write HTTP adapter uses authenticated Owner identity for all commands", async () => {
  const calls: unknown[] = [];
  const snapshot = { id: "approval-1", runId: "run-1", receiptId: "receipt-1",
    operationId: "operation-1", kind: "workspace", toolRevision: "revision-1",
    payloadHash: "hash", targetStateHash: "target", status: "pending",
    expiresAt: 1000, preview: {}, runVersion: 1,
    runStatus: "waiting" } as const;
  const runtime = {
    propose: async (input: unknown) => { calls.push(["propose", input]); return snapshot; },
    inspect: async (...args: unknown[]) => { calls.push(["inspect", args]); return snapshot; },
    review: async (...args: unknown[]) => { calls.push(["review", args]); return {
      approval: snapshot, payload: { key: "storySkeleton", content: "新骨架" },
    }; },
    list: async (...args: unknown[]) => { calls.push(["list", args]); return [snapshot]; },
    decide: async (input: unknown) => { calls.push(["decide", input]); return snapshot; },
  } as unknown as Runtime;
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: 5 };
    next();
  }, createScriptWriteApprovalsRouter(runtime));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const port = address.port;
    async function post(path: string, body: unknown) {
      return fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    assert.equal((await post("/propose", { projectId: 7,
      clientRequestId: "request-1", operationId: "operation-1",
      kind: "workspace", payload: { key: "storySkeleton", content: "新骨架" },
      actorUserId: 99 })).status, 200);
    assert.equal((await post("/inspect", { projectId: 7,
      runId: "run-1", actorUserId: 99 })).status, 200);
    const review = await post("/review", { projectId: 7,
      runId: "run-1", approvalId: "approval-1", actorUserId: 99 });
    assert.equal(review.status, 200);
    assert.equal(review.headers.get("cache-control"), "no-store");
    assert.equal((await post("/list", { projectId: 7,
      actorUserId: 99 })).status, 200);
    assert.equal((await post("/decide", { projectId: 7,
      runId: "run-1", approvalId: "approval-1",
      clientCommandId: "approve-1", expectedVersion: 1,
      decision: "approve", actorUserId: 99 })).status, 200);
    assert.deepEqual(calls, [
      ["propose", { projectId: 7, clientRequestId: "request-1",
        operationId: "operation-1", kind: "workspace",
        payload: { key: "storySkeleton", content: "新骨架" }, actorUserId: 5 }],
      ["inspect", [7, "run-1", 5]],
      ["review", [7, "run-1", "approval-1", 5]],
      ["list", [7, 5]],
      ["decide", { projectId: 7, runId: "run-1",
        approvalId: "approval-1", clientCommandId: "approve-1",
        expectedVersion: 1, decision: "approve", actorUserId: 5 }],
    ]);
  } finally { server.close(); await once(server, "close"); }
});
