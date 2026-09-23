import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";
import knexFactory from "knex";

import { AgentTraceExportUnavailableError, createAgentTraceEvidenceRuntime } from "../src/agentRuntime/traceEvidence";
import { createAgentTraceEvidenceRouter } from "../src/routes/agentRuns/traceEvidence";

async function fixture() {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_project", (t) => { t.integer("id").primary(); t.integer("userId"); });
  await db.schema.createTable("o_agentRun", (t) => { t.text("id").primary(); t.integer("projectId"); });
  await db.schema.createTable("o_agentTrace", (t) => {
    t.text("id").primary(); t.text("runId"); t.text("stepId"); t.text("attemptId");
    t.text("toolReceiptId"); t.text("toolCallId"); t.text("vendorRequestId");
    t.text("imageArtifactId"); t.text("predecessorTraceId"); t.integer("sequence");
    t.text("eventType"); t.text("runStatus"); t.text("stepStatus");
    t.text("diagnosticSchemaVersion"); t.text("diagnostic"); t.integer("createdAt");
  });
  await db("o_project").insert({ id: 7, userId: 1 });
  await db("o_agentRun").insert({ id: "run-1", projectId: 7 });
  await db("o_agentTrace").insert([
    { id: "trace-1", runId: "run-1", sequence: 1, eventType: "run.created", createdAt: 200 },
    { id: "trace-2", runId: "run-1", predecessorTraceId: "trace-1", sequence: 2,
      eventType: "vendor.request.submission-unknown", runStatus: "waiting", createdAt: 100 },
  ]);
  return { db, runtime: createAgentTraceEvidenceRuntime(async (operation) => operation(db)) };
}

test("owner-only export uses sequence, excludes payload fields and rejects corrupt evidence", async () => {
  const { db, runtime } = await fixture();
  try {
    const input = { projectId: 7, runId: "run-1", actorUserId: 1 };
    const exported = await runtime.export(input);
    assert.equal(exported?.schemaVersion, "toonflow.agent-trace-export.v1");
    assert.equal(exported?.timeline.linkage, "linked");
    assert.equal(exported?.retention.databaseRetention, "project-lifetime");
    assert.equal(exported?.redaction.result, "passed");
    assert.deepEqual(exported?.events.map((event) => event.id), ["trace-1", "trace-2"]);
    assert.ok(exported!.events[1].createdAt < exported!.events[0].createdAt);
    assert.equal(JSON.stringify(exported).includes("mediaPath"), false);
    await assert.rejects(runtime.export({ ...input, actorUserId: 2 }), AgentTraceExportUnavailableError);
    await db("o_agentTrace").where({ id: "trace-2" }).update({ predecessorTraceId: "wrong" });
    await assert.rejects(runtime.export(input), AgentTraceExportUnavailableError);
    await db("o_agentTrace").where({ id: "trace-2" }).update({ predecessorTraceId: "trace-1",
      diagnosticSchemaVersion: "toonflow.trace-safe-diagnostic.v1", diagnostic: JSON.stringify({ rawProviderPayload: "secret" }) });
    await assert.rejects(runtime.export(input), AgentTraceExportUnavailableError);
  } finally { await db.destroy(); }
});

test("Trace export route takes actor from authentication and never echoes unsafe evidence", async () => {
  const { db, runtime } = await fixture();
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { (req as typeof req & { user: { id: number } }).user = { id: 1 }; next(); });
  app.use(createAgentTraceEvidenceRouter(runtime));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address(); assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: 7, runId: "run-1", actorUserId: 2 }) });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.data.evidence.runId, "run-1");
    assert.equal(body.data.evidence.events.length, 2);
    await db("o_agentTrace").where({ id: "trace-2" }).update({ eventType: "https://unsafe.example/secret" });
    const rejected = await fetch(`http://127.0.0.1:${address.port}/`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: 7, runId: "run-1" }) });
    assert.equal(rejected.status, 409);
    assert.equal(JSON.stringify(await rejected.json()).includes("unsafe.example"), false);
  } finally { server.close(); await once(server, "close"); await db.destroy(); }
});
