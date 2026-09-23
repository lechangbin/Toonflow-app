import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { appendCausalTrace } from "../src/agentRuntime/causalTrace";

test("causal Trace links ordered events and rejects an entity owned by another Run", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.schema.createTable("o_agentRunStep", (t) => { t.text("id").primary(); t.text("runId").notNullable(); });
    await db.schema.createTable("o_agentTrace", (t) => {
      t.text("id").primary(); t.text("runId").notNullable(); t.text("stepId");
      t.text("predecessorTraceId"); t.integer("sequence").notNullable();
      t.text("eventType").notNullable(); t.integer("createdAt").notNullable();
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
    const rows = await db("o_agentTrace").where({ runId: "run-a" }).orderBy("sequence");
    assert.deepEqual(rows.map((row) => [row.id, row.sequence, row.predecessorTraceId]),
      [["trace-a", 1, null], ["trace-b", 2, "trace-a"]]);
    assert.ok(rows[1].createdAt < rows[0].createdAt, "causality comes from sequence, not wall-clock arrival");
  } finally { await db.destroy(); }
});
