import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";
import knexFactory from "knex";

import { AGENT_EVIDENCE_RETENTION_POLICY, deleteProjectAgentEvidence } from "../src/agentRuntime/retention";
import initDB from "../src/lib/initDB";
import { createDeleteProjectRouter } from "../src/routes/project/delProject";

async function fixture() {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.raw("PRAGMA foreign_keys = OFF");
  await initDB(db);
  await db.raw("PRAGMA foreign_keys = ON");
  await db("o_project").insert([{ id: 7, userId: 1 }, { id: 8, userId: 2 }]);
  const run = (id: string, projectId: number) => ({ id, projectId, role: "productionAgent",
    scope: "approved-billable-image-v1", clientRequestId: id, requestFingerprint: "fingerprint",
    input: "{}", status: "waiting", allowedActions: '["inspect"]', version: 1, createdAt: 100, updatedAt: 100 });
  await db("o_agentRun").insert([run("run-7", 7), run("run-8", 8)]);
  await db("o_agentRunStep").insert({ id: "step-7", runId: "run-7", ordinal: 1, kind: "tool",
    logicalTarget: "{}", promptFingerprint: "fingerprint", status: "waiting" });
  await db("o_agentRunAttempt").insert({ id: "attempt-7", runId: "run-7", stepId: "step-7",
    ordinal: 1, reason: "initial", status: "waiting", createdAt: 100 });
  await db("o_agentToolReceipt").insert({ id: "receipt-7", runId: "run-7", operationId: "operation-7",
    toolName: "generate_asset_image", toolRevision: "v1", inputHash: "hash", status: "pending",
    createdAt: 100, updatedAt: 100 });
  await db("o_agentToolApproval").insert({ id: "approval-7", runId: "run-7", receiptId: "receipt-7",
    operationId: "operation-7", toolRevision: "v1", contractHash: "hash", payloadJson: "{}",
    payloadHash: "hash", targetStateHash: "hash", previewJson: "{}", status: "approved",
    expiresAt: 1000, createdAt: 100 });
  await db("o_agentToolCall").insert({ id: "call-7", runId: "run-7", stepId: "step-7",
    attemptId: "attempt-7", receiptId: "receipt-7", approvalId: "approval-7",
    toolName: "generate_asset_image", toolRevision: "v1", inputHash: "hash", status: "running",
    createdAt: 100, updatedAt: 100 });
  await db("o_agentVendorRequest").insert({ id: "vendor-7", runId: "run-7", toolCallId: "call-7",
    projectId: 7, assetId: 11, requestId: "request-7", scopeHash: "hash", vendorId: "vendor",
    modelId: "model", resolution: "1K", maxCalls: 1, estimatedMaxCostMicros: 100,
    currency: "USD", status: "submitted", imageId: 12, version: 1, createdAt: 100, updatedAt: 100 });
  await db("o_agentImageArtifact").insert({ id: "artifact-7", vendorRequestId: "vendor-7",
    assetId: 11, imageId: 12, contentHash: "a".repeat(64), mediaPath: "/7/media.png",
    status: "observed", createdAt: 100, updatedAt: 100 });
  await db("o_agentTrace").insert({ id: "trace-7", runId: "run-7", stepId: "step-7",
    attemptId: "attempt-7", toolReceiptId: "receipt-7", toolCallId: "call-7",
    vendorRequestId: "vendor-7", imageArtifactId: "artifact-7", sequence: 1,
    eventType: "artifact.observed", createdAt: 100 });
  await db("o_agentImageQuotePolicy").insert({ id: "quote-7", projectId: 7, vendorId: "vendor",
    modelId: "model", resolution: "1K", estimatedMaxCostMicros: 100,
    currency: "USD", revision: 1, updatedByUserId: 1, updatedAt: 100 });
  await db("o_agentVideoQuotePolicy").insert({ id: "video-quote-7", projectId: 7,
    scopeKey: "video-scope-7", scopeJson: "{}", estimatedMaxCostMicros: 200,
    currency: "USD", revision: 1, updatedByUserId: 1, updatedAt: 100 });
  await db("o_agentVideoVendorRequest").insert({ id: "video-vendor-7",
    runId: "run-7", toolCallId: "call-7", projectId: 7, trackId: 31,
    requestId: "video-request-7", scopeHash: "hash", vendorId: "vendor",
    modelId: "model", commandHash: "command-hash",
    estimatedMaxCostMicros: 200, currency: "USD",
    status: "unknown", version: 1, createdAt: 100, updatedAt: 100 });
  await db("o_agentVideoArtifact").insert({ id: "video-artifact-7",
    vendorRequestId: "video-vendor-7", trackId: 31,
    mediaPath: "/7/agent-video/video-request-7/hash.mp4", contentHash: "hash",
    status: "late", createdAt: 100, updatedAt: 100 });
  return db;
}

test("active Project keeps approval evidence; Project deletion purges all related Agent rows", async () => {
  const db = await fixture();
  try {
    assert.equal(AGENT_EVIDENCE_RETENTION_POLICY.redactedExportRetention, "not-persisted");
    await assert.rejects(db("o_agentToolApproval").where({ id: "approval-7" }).delete(), /durable evidence/);
    await db.transaction(async (tx) => {
      await tx("o_project").where({ id: 7, userId: 1 }).delete();
      await deleteProjectAgentEvidence(tx, 7);
    });
    for (const table of ["o_agentRun", "o_agentRunStep", "o_agentRunAttempt", "o_agentToolReceipt",
      "o_agentToolApproval", "o_agentToolCall", "o_agentVendorRequest", "o_agentImageArtifact",
      "o_agentTrace", "o_agentImageQuotePolicy", "o_agentVideoQuotePolicy",
      "o_agentVideoVendorRequest", "o_agentVideoArtifact"]) {
      assert.equal((await db(table)).filter((row: any) => JSON.stringify(row).includes("-7")).length, 0, table);
    }
    assert.equal((await db("o_agentEvidenceDeletionPermit")).length, 0);
    assert.equal((await db("o_agentRun").where({ id: "run-8" })).length, 1);
    assert.equal((await db("o_project").where({ id: 8 })).length, 1);
  } finally { await db.destroy(); }
});

test("a failed evidence purge rolls back Project deletion", async () => {
  const db = await fixture();
  try {
    await db.raw(`CREATE TRIGGER reject_trace_purge BEFORE DELETE ON o_agentTrace
      BEGIN SELECT RAISE(ABORT, 'simulated purge failure'); END`);
    await assert.rejects(db.transaction(async (tx) => {
      await tx("o_project").where({ id: 7, userId: 1 }).delete();
      await deleteProjectAgentEvidence(tx, 7);
    }), /simulated purge failure/);
    assert.equal((await db("o_project").where({ id: 7 })).length, 1);
    assert.equal((await db("o_agentToolApproval").where({ id: "approval-7" })).length, 1);
  } finally { await db.destroy(); }
});

test("Project deletion requires the authenticated owner and reports media cleanup separately", async () => {
  const db = await fixture();
  let actorUserId = 2;
  const mediaPaths: string[] = [];
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: actorUserId }; next();
  });
  app.use(createDeleteProjectRouter({ work: async (operation) => operation(db),
    deleteDirectory: async (path) => { mediaPaths.push(path); throw new Error("media cleanup failed"); } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address(); assert(address && typeof address === "object");
    const remove = async () => fetch(`http://127.0.0.1:${address.port}/`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ id: 7 }) });
    const denied = await remove();
    assert.equal(denied.status, 404);
    assert.equal((await db("o_agentRun").where({ id: "run-7" })).length, 1);
    assert.deepEqual(mediaPaths, []);
    actorUserId = 1;
    const accepted = await remove();
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json() as any).data.mediaCleanup, "failed");
    assert.deepEqual(mediaPaths, ["7/"]);
    assert.equal((await db("o_agentRun").where({ id: "run-7" })).length, 0);
  } finally { server.close(); await once(server, "close"); await db.destroy(); }
});
