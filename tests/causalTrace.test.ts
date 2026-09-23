import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { appendCausalTrace, auditCausalTraceTimeline, auditTraceFailureClassification } from "../src/agentRuntime/causalTrace";

test("timeline evidence distinguishes linked, legacy and corrupt history without trusting timestamps", () => {
  const linked = [
    { id: "a", sequence: 1, predecessorTraceId: null },
    { id: "b", sequence: 2, predecessorTraceId: "a" },
  ];
  assert.deepEqual(auditCausalTraceTimeline(linked), {
    schemaVersion: "toonflow.trace-timeline-evidence.v1", ordering: "durable-sequence",
    linkage: "linked", eventCount: 2,
  });
  assert.equal(auditCausalTraceTimeline([{ ...linked[0] }, { ...linked[1], predecessorTraceId: null }]).linkage,
    "legacy-unlinked");
  assert.equal(auditCausalTraceTimeline([{ ...linked[0] }, { ...linked[1], predecessorTraceId: "wrong" }]).linkage,
    "corrupt");
  assert.equal(auditCausalTraceTimeline([{ ...linked[0] }, { ...linked[1], sequence: 3 }]).linkage,
    "corrupt");
});

test("failure classification does not invent diagnostics for old rows", () => {
  assert.deepEqual(auditTraceFailureClassification([
    { eventType: "run.created", diagnostic: null },
    { eventType: "vendor.request.submission-unknown", diagnostic: null },
  ]), { schemaVersion: "toonflow.trace-failure-classification.v1", coverage: "legacy-unclassified",
    knownFailureEventCount: 1, classifiedFailureEventCount: 0 });
  assert.deepEqual(auditTraceFailureClassification([
    { eventType: "run.created", diagnostic: null },
    { eventType: "run.failed", diagnostic: "validated-on-export" },
  ]), { schemaVersion: "toonflow.trace-failure-classification.v1", coverage: "complete",
    knownFailureEventCount: 1, classifiedFailureEventCount: 1 });
});

test("causal Trace links ordered events and rejects an entity owned by another Run", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.schema.createTable("o_agentRunStep", (t) => { t.text("id").primary(); t.text("runId").notNullable(); });
    await db.schema.createTable("o_agentTrace", (t) => {
      t.text("id").primary(); t.text("runId").notNullable(); t.text("stepId");
      t.text("predecessorTraceId"); t.integer("sequence").notNullable();
      t.text("eventType").notNullable(); t.text("diagnosticSchemaVersion"); t.text("diagnostic");
      t.integer("createdAt").notNullable();
      t.unique(["runId", "sequence"]);
    });
    await db("o_agentRunStep").insert([{ id: "step-a", runId: "run-a" }, { id: "step-b", runId: "run-b" }]);
    await db.transaction((tx) => appendCausalTrace(tx, {
      id: "trace-a", runId: "run-a", stepId: "step-a", eventType: "run.created", createdAt: 100,
    }));
    await assert.rejects(db.transaction((tx) => appendCausalTrace(tx, {
      id: "wrong-run", runId: "run-a", stepId: "step-b", eventType: "run.started", createdAt: 101,
    })), /does not belong to Run/);
    await db.transaction((tx) => appendCausalTrace(tx, {
      id: "trace-b", runId: "run-a", stepId: "step-a", eventType: "run.started", createdAt: 99,
    }));
    await assert.rejects(db.transaction((tx) => appendCausalTrace(tx, {
      id: "missing-diagnostic", runId: "run-a", stepId: "step-a", eventType: "run.failed", createdAt: 102,
    })), /requires a safe diagnostic/);
    const rows = await db("o_agentTrace").where({ runId: "run-a" }).orderBy("sequence");
    assert.deepEqual(rows.map((row) => [row.id, row.sequence, row.predecessorTraceId]),
      [["trace-a", 1, null], ["trace-b", 2, "trace-a"]]);
    assert.ok(rows[1].createdAt < rows[0].createdAt, "causality comes from sequence, not wall-clock arrival");
  } finally { await db.destroy(); }
});
