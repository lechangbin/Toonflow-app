import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import { recoverInterruptedWork } from "../src/database/readiness";
import initDB from "../src/lib/initDB";

const AGENT_TABLES = ["o_agentRun", "o_agentRunStep", "o_agentRunOutput", "o_agentTrace"] as const;

function createTemporaryDatabase(): { directory: string; knex: Knex } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-agent-run-schema-"));
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(directory, "db.sqlite") },
    useNullAsDefault: true,
  });
  return { directory, knex };
}

async function initializeSchema(knex: Knex): Promise<void> {
  // Avoid initializing unrelated embedding fixtures; these tests exercise the
  // Agent Run schema and recovery contract only.
  await knex.raw("PRAGMA foreign_keys = OFF");
  await knex.schema.createTable("o_skillList", (table) => table.text("id").primary());
  await initDB(knex);
}

async function dispose(directory: string, knex: Knex): Promise<void> {
  await knex.destroy();
  fs.rmSync(directory, { recursive: true, force: true });
}

test("a fresh database owns the four durable Agent Run records and their uniqueness contracts", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);

    for (const tableName of AGENT_TABLES) assert.equal(await knex.schema.hasTable(tableName), true);

    const runColumns = await knex("o_agentRun").columnInfo();
    for (const required of [
      "id",
      "projectId",
      "scriptId",
      "role",
      "scope",
      "clientRequestId",
      "requestFingerprint",
      "input",
      "status",
      "waitingReason",
      "attentionReason",
      "allowedActions",
      "version",
      "failureDiagnostic",
    ]) {
      assert.ok(runColumns[required], `o_agentRun owns ${required}`);
    }

    const run = {
      id: "run-1",
      projectId: 7,
      role: "projectAgent",
      scope: "read-only-summary",
      clientRequestId: "request-1",
      requestFingerprint: "a".repeat(64),
      input: JSON.stringify({ content: "read-only request" }),
      status: "queued",
      allowedActions: JSON.stringify(["inspect"]),
      version: 1,
      createdAt: 100,
      updatedAt: 100,
    };
    await knex("o_agentRun").insert(run);
    await assert.rejects(() => knex("o_agentRun").insert({ ...run, id: "run-2" }), /unique/i);

    await knex("o_agentRunStep").insert({
      id: "step-1",
      runId: run.id,
      ordinal: 1,
      kind: "model",
      logicalTarget: "universalAi",
      resolvedTarget: "fake:text-model",
      promptFingerprint: "b".repeat(64),
      status: "succeeded",
      startedAt: 101,
      completedAt: 102,
    });
    await knex("o_agentRunOutput").insert({
      id: "output-1",
      runId: run.id,
      stepId: "step-1",
      kind: "assistant-text",
      content: "safe final output",
      contentHash: "c".repeat(64),
      schemaVersion: "toonflow.agent-run-output.v1",
      createdAt: 102,
    });
    await knex("o_agentTrace").insert({
      id: "trace-1",
      runId: run.id,
      stepId: "step-1",
      sequence: 1,
      eventType: "model-step-succeeded",
      runStatus: "succeeded",
      stepStatus: "succeeded",
      createdAt: 102,
    });

    await assert.rejects(
      () =>
        knex("o_agentTrace").insert({
          id: "trace-2",
          runId: run.id,
          sequence: 1,
          eventType: "duplicate-sequence",
          createdAt: 103,
        }),
      /unique/i,
    );
  } finally {
    await dispose(directory, knex);
  }
});

test("an upgraded database gains the four Agent Run tables without rewriting existing Project data", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);
    await knex("o_project").insert({ id: 7, name: "existing project" });
    for (const tableName of [...AGENT_TABLES].reverse()) await knex.schema.dropTable(tableName);

    await initDB(knex);

    for (const tableName of AGENT_TABLES) assert.equal(await knex.schema.hasTable(tableName), true);
    const project = await knex("o_project").where("id", 7).first();
    assert.equal(project.name, "existing project");
  } finally {
    await dispose(directory, knex);
  }
});

test("readiness recovery parks an interrupted Model call with attention and one Trace-safe event", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);
    await knex("o_agentRun").insert([
      {
        id: "run-interrupted",
        projectId: 7,
        role: "projectAgent",
        scope: "read-only-summary",
        clientRequestId: "request-interrupted",
        requestFingerprint: "d".repeat(64),
        input: JSON.stringify({ content: "interrupted request" }),
        status: "running",
        allowedActions: JSON.stringify(["inspect"]),
        version: 3,
        createdAt: 100,
        updatedAt: 101,
        startedAt: 101,
      },
      {
        id: "run-finished",
        projectId: 7,
        role: "projectAgent",
        scope: "read-only-summary",
        clientRequestId: "request-finished",
        requestFingerprint: "e".repeat(64),
        input: JSON.stringify({ content: "finished request" }),
        status: "succeeded",
        allowedActions: JSON.stringify(["inspect"]),
        version: 2,
        createdAt: 90,
        updatedAt: 99,
        startedAt: 91,
        completedAt: 99,
      },
      {
        id: "run-queued",
        projectId: 7,
        role: "projectAgent",
        scope: "read-only-summary",
        clientRequestId: "request-queued",
        requestFingerprint: "1".repeat(64),
        input: JSON.stringify({ content: "queued request" }),
        status: "queued",
        allowedActions: JSON.stringify(["inspect"]),
        version: 1,
        createdAt: 102,
        updatedAt: 102,
      },
    ]);
    await knex("o_agentRunStep").insert([
      {
        id: "step-interrupted",
        runId: "run-interrupted",
        ordinal: 1,
        kind: "model",
        logicalTarget: "universalAi",
        resolvedTarget: "fake:text-model",
        promptFingerprint: "f".repeat(64),
        status: "running",
        startedAt: 101,
      },
      {
        id: "step-finished",
        runId: "run-finished",
        ordinal: 1,
        kind: "model",
        logicalTarget: "universalAi",
        resolvedTarget: "fake:text-model",
        promptFingerprint: "0".repeat(64),
        status: "succeeded",
        startedAt: 91,
        completedAt: 99,
      },
      {
        id: "step-queued",
        runId: "run-queued",
        ordinal: 1,
        kind: "model",
        logicalTarget: "universalAi",
        promptFingerprint: "2".repeat(64),
        status: "pending",
      },
    ]);
    await knex("o_agentTrace").insert({
      id: "trace-started",
      runId: "run-interrupted",
      stepId: "step-interrupted",
      sequence: 1,
      eventType: "model-step-started",
      runStatus: "running",
      stepStatus: "running",
      createdAt: 101,
    });

    const context = { knex, dataRoot: directory, databaseFile: path.join(directory, "db.sqlite") };
    await recoverInterruptedWork(context);
    const firstRecovery = await knex("o_agentRun").where("id", "run-interrupted").first();
    await recoverInterruptedWork(context);

    const recovered = await knex("o_agentRun").where("id", "run-interrupted").first();
    assert.equal(recovered.status, "waiting");
    assert.equal(recovered.waitingReason, "interrupted-model-call");
    assert.equal(recovered.attentionReason, "interrupted-model-call");
    assert.deepEqual(JSON.parse(recovered.allowedActions), ["inspect"]);
    assert.equal(recovered.version, 4);
    assert.equal(recovered.updatedAt, firstRecovery.updatedAt, "idempotent recovery does not rewrite the waiting Run");
    assert.ok(recovered.updatedAt >= recovered.startedAt);
    assert.equal(recovered.completedAt, null);

    const recoveredStep = await knex("o_agentRunStep").where("id", "step-interrupted").first();
    assert.equal(recoveredStep.status, "waiting");
    assert.equal(recoveredStep.completedAt, null);

    const traces = await knex("o_agentTrace").where("runId", "run-interrupted").orderBy("sequence", "asc");
    assert.equal(traces.length, 2, "recovery is idempotent after the Run leaves running");
    assert.equal(traces[1].sequence, 2);
    assert.equal(traces[1].eventType, "interrupted-model-call");
    const diagnostic = JSON.parse(traces[1].diagnostic);
    assert.equal(diagnostic.schemaVersion, "toonflow.trace-safe-diagnostic.v1");
    assert.equal(diagnostic.audience, "trace");
    assert.equal(diagnostic.certainty, "unknown-effect");
    assert.equal(diagnostic.retryDisposition, "reconcile-first");
    assert.equal(JSON.stringify(diagnostic).includes("provider"), false);

    const finished = await knex("o_agentRun").where("id", "run-finished").first();
    assert.equal(finished.status, "succeeded", "terminal Runs are untouched");
    assert.equal(finished.updatedAt, 99);

    const queued = await knex("o_agentRun").where("id", "run-queued").first();
    assert.equal(queued.status, "waiting", "a committed intent is not left queued after its in-memory scheduler disappears");
    assert.equal(queued.waitingReason, "interrupted-before-model-call");
    const queuedDiagnostic = JSON.parse(queued.failureDiagnostic);
    assert.equal(queuedDiagnostic.certainty, "known-no-effect");
    assert.equal(queuedDiagnostic.retryDisposition, "safe-retry");
    assert.equal((await knex("o_agentRunStep").where("id", "step-queued").first()).status, "waiting");
    assert.equal((await knex("o_agentTrace").where("runId", "run-queued")).length, 1);
  } finally {
    await dispose(directory, knex);
  }
});
