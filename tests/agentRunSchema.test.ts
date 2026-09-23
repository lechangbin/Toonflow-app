import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import {
  AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
  canonicalCheckpointPayload,
  hashCheckpointPayload,
  type AgentRunCheckpointPayload,
} from "../src/agentRuntime/checkpoints";
import { recoverInterruptedWork } from "../src/database/readiness";
import fixDB from "../src/lib/fixDB";
import initDB from "../src/lib/initDB";

const AGENT_TABLES = [
  "o_agentRun",
  "o_agentRunStep",
  "o_agentRunAttempt",
  "o_agentRunOutput",
  "o_agentRunCheckpoint",
  "o_agentRunCommand",
  "o_agentToolDefinition",
  "o_agentToolReceipt",
  "o_agentToolApproval",
  "o_agentEvidenceDeletionPermit",
  "o_agentTrace",
] as const;

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

async function insertCheckpoint(knex: Knex, id: string, payload: AgentRunCheckpointPayload): Promise<void> {
  await knex("o_agentRunCheckpoint").insert({
    id,
    runId: payload.runId,
    stepId: payload.stepId,
    attemptId: payload.attemptId,
    sequence: payload.sequence,
    kind: payload.kind,
    schemaVersion: payload.schemaVersion,
    runVersion: payload.runVersion,
    lastCommittedStepId: payload.lastCommittedStepId,
    predecessorCheckpointId: payload.predecessorCheckpointId,
    payload: canonicalCheckpointPayload(payload),
    payloadHash: hashCheckpointPayload(payload),
    createdAt: 100 + payload.sequence,
  });
}

test("a fresh database owns durable Run, Step, Attempt, Output, Checkpoint and Trace records", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);

    for (const tableName of AGENT_TABLES) assert.equal(await knex.schema.hasTable(tableName), true);

    const runColumns = await knex("o_agentRun").columnInfo();
    const traceColumns = await knex("o_agentTrace").columnInfo();
    for (const column of ["toolReceiptId", "attemptId", "toolCallId", "vendorRequestId", "imageArtifactId", "predecessorTraceId"]) {
      assert.ok(traceColumns[column], `o_agentTrace owns ${column}`);
    }
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
      "lastCommittedStepId",
      "leaseOwnerId",
      "leaseEpoch",
      "leaseExpiresAt",
      "fence",
      "cancellationRequestedAt",
      "cancellationCommandId",
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
    await knex("o_agentRunAttempt").insert({
      id: "attempt-1",
      runId: run.id,
      stepId: "step-1",
      ordinal: 1,
      reason: "initial",
      status: "succeeded",
      resolvedTarget: "fake:text-model",
      invocationFingerprint: "d".repeat(64),
      createdAt: 100,
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

    const checkpointPayload: AgentRunCheckpointPayload = {
      schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
      runId: run.id,
      stepId: "step-1",
      attemptId: "attempt-1",
      sequence: 1,
      runVersion: 1,
      lastCommittedStepId: null,
      predecessorCheckpointId: null,
      predecessorPayloadHash: null,
      kind: "run-created",
      requestFingerprint: run.requestFingerprint,
    };
    await knex("o_agentRunCheckpoint").insert({
      id: "checkpoint-1",
      runId: run.id,
      stepId: "step-1",
      attemptId: "attempt-1",
      sequence: 1,
      kind: checkpointPayload.kind,
      schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
      runVersion: 1,
      predecessorCheckpointId: null,
      lastCommittedStepId: null,
      payload: canonicalCheckpointPayload(checkpointPayload),
      payloadHash: hashCheckpointPayload(checkpointPayload),
      createdAt: 100,
    });
    await assert.rejects(
      () => knex("o_agentRunCheckpoint").where("id", "checkpoint-1").update({ runVersion: 2 }),
      /immutable/i,
    );
    const duplicateRevision: AgentRunCheckpointPayload = {
      ...checkpointPayload,
      kind: "attempt-created",
      reason: "recovery",
      predecessorAttemptId: "attempt-1",
      sequence: 2,
      predecessorCheckpointId: "checkpoint-1",
      predecessorPayloadHash: hashCheckpointPayload(checkpointPayload),
    };
    await assert.rejects(
      () => insertCheckpoint(knex, "checkpoint-duplicate-revision", duplicateRevision),
      /unique/i,
      "one Run revision cannot fork into two checkpoints",
    );

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

test("ToolDefinition revisions cannot be updated or deleted", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);
    await knex("o_agentToolDefinition").insert({
      id: "definition-1", name: "get_novel_text", revision: "v1",
      contractHash: "a".repeat(64), policy: "{}", createdAt: 100,
    });
    await assert.rejects(knex("o_agentToolDefinition").where("id", "definition-1").update({ contractHash: "b".repeat(64) }), /immutable/i);
    await assert.rejects(knex("o_agentToolDefinition").where("id", "definition-1").del(), /immutable/i);
  } finally { await dispose(directory, knex); }
});

test("T08 approval binding is immutable and upgrades without rewriting old Runs", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);
    await knex("o_agentRun").insert({
      id: "prior-run", projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "prior-request", requestFingerprint: "a".repeat(64), input: "{}",
      status: "succeeded", allowedActions: JSON.stringify(["inspect"]), version: 3,
      createdAt: 90, updatedAt: 99, completedAt: 99,
    });
    await knex.schema.dropTable("o_agentToolApproval");
    await initDB(knex);
    assert.equal(await knex.schema.hasTable("o_agentToolApproval"), true);
    assert.equal((await knex("o_agentRun").where("id", "prior-run").first()).version, 3);
    await knex("o_agentToolApproval").insert({
      id: "approval-1", runId: "prior-run", receiptId: "receipt-1", operationId: "operation-1",
      toolRevision: "v1", contractHash: "a".repeat(64), payloadJson: "{}",
      payloadHash: "b".repeat(64), targetStateHash: "c".repeat(64), previewJson: "{}",
      status: "pending", expiresAt: 200, createdAt: 100,
    });
    await assert.rejects(knex("o_agentToolApproval").where("id", "approval-1").update({ payloadHash: "d".repeat(64) }), /immutable/i);
    await assert.rejects(knex("o_agentToolApproval").where("id", "approval-1").del(), /durable evidence/i);
    assert.equal(await knex("o_agentToolApproval").where("id", "approval-1").update({ status: "approved" }), 1);
  } finally { await dispose(directory, knex); }
});

test("T07 upgrade creates Tool tables and adds Trace receipt link without rewriting old Runs", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);
    await knex("o_agentRun").insert({
      id: "old-run", projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "old-request", requestFingerprint: "a".repeat(64),
      input: JSON.stringify({ content: "old" }), status: "succeeded",
      allowedActions: JSON.stringify(["inspect"]), version: 3, createdAt: 90, updatedAt: 99, completedAt: 99,
    });
    await knex.schema.dropTable("o_agentToolReceipt");
    await knex.schema.dropTable("o_agentToolDefinition");
    await knex.schema.alterTable("o_agentTrace", (table) => table.dropColumn("toolReceiptId"));
    for (const column of ["attemptId", "toolCallId", "vendorRequestId", "imageArtifactId", "predecessorTraceId"]) {
      await knex.schema.alterTable("o_agentTrace", (table) => table.dropColumn(column));
    }
    await initDB(knex);
    await fixDB(knex, directory);
    assert.equal(await knex.schema.hasTable("o_agentToolDefinition"), true);
    assert.equal(await knex.schema.hasTable("o_agentToolReceipt"), true);
    const upgradedTraceColumns = await knex("o_agentTrace").columnInfo();
    for (const column of ["toolReceiptId", "attemptId", "toolCallId", "vendorRequestId", "imageArtifactId", "predecessorTraceId"]) {
      assert.ok(upgradedTraceColumns[column], `upgraded o_agentTrace owns ${column}`);
    }
    const old = await knex("o_agentRun").where("id", "old-run").first();
    assert.equal(old.status, "succeeded");
    assert.equal(old.version, 3);
  } finally { await dispose(directory, knex); }
});

test("an upgraded database gains the Agent Run history tables without rewriting existing Project data", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);
    await knex("o_project").insert({ id: 7, name: "existing project" });
    for (const tableName of [...AGENT_TABLES].reverse()) await knex.schema.dropTable(tableName);

    await initDB(knex);

    for (const tableName of AGENT_TABLES) assert.equal(await knex.schema.hasTable(tableName), true);
    const project = await knex("o_project").where("id", 7).first();
    assert.equal(project.name, "existing project");
    assert.ok((await knex("o_agentRun").columnInfo()).lastCommittedStepId);
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
    assert.equal(traces[1].predecessorTraceId, traces[0].id);
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
    assert.equal(queuedDiagnostic.failureClass, "Decision");
    assert.equal(queuedDiagnostic.certainty, "known-no-effect");
    assert.equal(queuedDiagnostic.retryDisposition, "safe-retry");
    assert.equal((await knex("o_agentRunStep").where("id", "step-queued").first()).status, "waiting");
    assert.equal((await knex("o_agentTrace").where("runId", "run-queued")).length, 1);
  } finally {
    await dispose(directory, knex);
  }
});

test("readiness recovery rejects a Run with multiple active Steps without partial writes", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);
    await knex("o_agentRun").insert({
      id: "run-corrupt", projectId: 7, role: "projectAgent", scope: "read-only-summary",
      clientRequestId: "request-corrupt", requestFingerprint: "3".repeat(64),
      input: JSON.stringify({ content: "corrupt request" }), status: "running",
      allowedActions: JSON.stringify(["inspect"]), version: 1, createdAt: 100, updatedAt: 101, startedAt: 101,
    });
    await knex("o_agentRunStep").insert([1, 2].map((ordinal) => ({
      id: `step-corrupt-${ordinal}`, runId: "run-corrupt", ordinal, kind: "model",
      logicalTarget: "universalAi", promptFingerprint: String(ordinal).repeat(64), status: "running", startedAt: 101,
    })));
    const context = { knex, dataRoot: directory, databaseFile: path.join(directory, "db.sqlite") };
    await assert.rejects(recoverInterruptedWork(context), /exactly one active Model Step/u);
    assert.equal((await knex("o_agentRun").where("id", "run-corrupt").first()).status, "running");
    assert.equal((await knex("o_agentRunStep").where("runId", "run-corrupt").andWhere("status", "running")).length, 2);
    assert.equal((await knex("o_agentTrace").where("runId", "run-corrupt")).length, 0);
  } finally {
    await dispose(directory, knex);
  }
});

test("readiness leaves a live lease alone, then recovers it only after expiry", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);
    await knex("o_agentRun").insert({
      id: "run-leased", projectId: 7, role: "projectAgent", scope: "read-only-summary",
      clientRequestId: "request-leased", requestFingerprint: "f".repeat(64),
      input: JSON.stringify({ content: "safe request" }), status: "queued",
      allowedActions: JSON.stringify(["inspect"]), version: 2, fence: 1,
      leaseOwnerId: "worker-a", leaseEpoch: "epoch-a", leaseExpiresAt: 200,
      createdAt: 100, updatedAt: 101,
    });
    await knex("o_agentRunStep").insert({
      id: "step-leased", runId: "run-leased", ordinal: 1, kind: "model",
      logicalTarget: "universalAi", promptFingerprint: "e".repeat(64), status: "pending",
    });
    const { recoverInterruptedAgentRuns } = await import("../src/database/agentRunRecovery");
    await recoverInterruptedAgentRuns(knex, 199);
    assert.equal((await knex("o_agentRun").where("id", "run-leased").first()).status, "queued");
    assert.equal((await knex("o_agentTrace").where("runId", "run-leased")).length, 0);

    await recoverInterruptedAgentRuns(knex, 200);
    const recovered = await knex("o_agentRun").where("id", "run-leased").first();
    assert.equal(recovered.status, "waiting");
    assert.equal(recovered.waitingReason, "interrupted-before-model-call");
    assert.equal(recovered.leaseOwnerId, null);
    assert.equal(recovered.leaseEpoch, null);
    assert.equal(recovered.leaseExpiresAt, null);
    assert.equal(recovered.fence, 1, "recovery never rolls back the fence");
  } finally {
    await dispose(directory, knex);
  }
});

test("the upgrade path adds the committed-Step cursor to a T04 Run table without rewriting rows", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);
    await knex("o_agentRun").insert({
      id: "legacy-run", projectId: 7, role: "projectAgent", scope: "read-only-summary",
      clientRequestId: "legacy-request", requestFingerprint: "e".repeat(64),
      input: JSON.stringify({ content: "legacy" }), status: "succeeded",
      allowedActions: JSON.stringify(["inspect"]), version: 2, createdAt: 90, updatedAt: 99, completedAt: 99,
    });
    await knex.schema.alterTable("o_agentRun", (table) => table.dropColumn("lastCommittedStepId"));
    assert.equal(await knex.schema.hasColumn("o_agentRun", "lastCommittedStepId"), false);

    await fixDB(knex, directory);

    assert.equal(await knex.schema.hasColumn("o_agentRun", "lastCommittedStepId"), true);
    const legacy = await knex("o_agentRun").where("id", "legacy-run").first();
    assert.equal(legacy.status, "succeeded");
    assert.equal(legacy.version, 2);
    assert.equal(legacy.lastCommittedStepId, null);
  } finally {
    await dispose(directory, knex);
  }
});

test("the T06 upgrade adds lease and cancellation fields without rewriting a legacy Run", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);
    await knex("o_agentRun").insert({
      id: "legacy-t05", projectId: 7, role: "projectAgent", scope: "read-only-summary",
      clientRequestId: "legacy-t05-request", requestFingerprint: "c".repeat(64),
      input: JSON.stringify({ content: "legacy" }), status: "succeeded",
      allowedActions: JSON.stringify(["inspect"]), version: 3, createdAt: 90, updatedAt: 99, completedAt: 99,
    });
    await knex.schema.dropTable("o_agentRunCommand");
    for (const column of ["leaseOwnerId", "leaseEpoch", "leaseExpiresAt", "fence", "cancellationRequestedAt", "cancellationCommandId"]) {
      await knex.schema.alterTable("o_agentRun", (table) => table.dropColumn(column));
    }
    await initDB(knex);
    await fixDB(knex, directory);
    const legacy = await knex("o_agentRun").where("id", "legacy-t05").first();
    assert.equal(legacy.status, "succeeded");
    assert.equal(legacy.version, 3);
    assert.equal(legacy.fence, 0);
    assert.equal(legacy.leaseOwnerId, null);
    assert.equal(legacy.cancellationRequestedAt, null);
    assert.equal(await knex.schema.hasTable("o_agentRunCommand"), true);
  } finally {
    await dispose(directory, knex);
  }
});

test("checkpoint recovery creates one causal successor Attempt only before model-call-intent", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);
    await knex("o_agentRun").insert({
      id: "run-pre-intent", projectId: 7, role: "projectAgent", scope: "read-only-summary",
      clientRequestId: "request-pre-intent", requestFingerprint: "4".repeat(64),
      input: JSON.stringify({ content: "safe request" }), status: "queued",
      allowedActions: JSON.stringify(["inspect"]), version: 1, createdAt: 100, updatedAt: 100,
    });
    await knex("o_agentRunStep").insert({
      id: "step-pre-intent", runId: "run-pre-intent", ordinal: 1, kind: "model",
      logicalTarget: "universalAi", promptFingerprint: "5".repeat(64), status: "pending",
    });
    await knex("o_agentRunAttempt").insert({
      id: "attempt-pre-intent-1", runId: "run-pre-intent", stepId: "step-pre-intent",
      ordinal: 1, reason: "initial", status: "preparing", createdAt: 100,
    });
    await insertCheckpoint(knex, "checkpoint-pre-intent-1", {
      schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
      runId: "run-pre-intent", stepId: "step-pre-intent", attemptId: "attempt-pre-intent-1",
      sequence: 1, runVersion: 1, lastCommittedStepId: null,
      predecessorCheckpointId: null, predecessorPayloadHash: null,
      kind: "run-created", requestFingerprint: "4".repeat(64),
    });

    const context = { knex, dataRoot: directory, databaseFile: path.join(directory, "db.sqlite") };
    await recoverInterruptedWork(context);
    await recoverInterruptedWork(context);

    const run = await knex("o_agentRun").where("id", "run-pre-intent").first();
    assert.equal(run.status, "waiting");
    assert.equal(run.version, 2);
    assert.equal(run.waitingReason, "interrupted-before-model-call");
    const attempts = await knex("o_agentRunAttempt").where("runId", run.id).orderBy("ordinal", "asc");
    assert.equal(attempts.length, 2, "recovery is idempotent after parking the Run");
    assert.equal(attempts[0].status, "waiting");
    assert.equal(attempts[1].status, "preparing");
    assert.equal(attempts[1].predecessorAttemptId, attempts[0].id);
    const checkpoints = await knex("o_agentRunCheckpoint").where("runId", run.id).orderBy("sequence", "asc");
    assert.equal(checkpoints.length, 2);
    assert.equal(checkpoints[1].kind, "attempt-created");
    const payload = JSON.parse(checkpoints[1].payload);
    assert.equal(payload.predecessorCheckpointId, checkpoints[0].id);
    assert.equal(payload.predecessorPayloadHash, checkpoints[0].payloadHash);
    assert.equal(payload.predecessorAttemptId, attempts[0].id);
    const recoveryTrace = await knex("o_agentTrace").where({ runId: run.id }).orderBy("sequence", "desc").first();
    assert.equal(recoveryTrace.attemptId, attempts[1].id, "pre-intent recovery points to the successor Attempt");
  } finally {
    await dispose(directory, knex);
  }
});

test("checkpoint recovery never creates a successor after model-call-intent", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);
    const invocationFingerprint = "6".repeat(64);
    await knex("o_agentRun").insert({
      id: "run-post-intent", projectId: 7, role: "projectAgent", scope: "read-only-summary",
      clientRequestId: "request-post-intent", requestFingerprint: "7".repeat(64),
      input: JSON.stringify({ content: "safe request" }), status: "running",
      allowedActions: JSON.stringify(["inspect"]), version: 2, createdAt: 100, updatedAt: 101, startedAt: 101,
    });
    await knex("o_agentRunStep").insert({
      id: "step-post-intent", runId: "run-post-intent", ordinal: 1, kind: "model",
      logicalTarget: "universalAi", resolvedTarget: JSON.stringify({ vendorId: "fake", modelId: "text-model" }),
      promptFingerprint: "8".repeat(64), status: "running", startedAt: 101,
    });
    await knex("o_agentRunAttempt").insert({
      id: "attempt-post-intent-1", runId: "run-post-intent", stepId: "step-post-intent",
      ordinal: 1, reason: "initial", status: "running", invocationFingerprint,
      resolvedTarget: JSON.stringify({ vendorId: "fake", modelId: "text-model" }), createdAt: 100, startedAt: 101,
    });
    const created: AgentRunCheckpointPayload = {
      schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
      runId: "run-post-intent", stepId: "step-post-intent", attemptId: "attempt-post-intent-1",
      sequence: 1, runVersion: 1, lastCommittedStepId: null,
      predecessorCheckpointId: null, predecessorPayloadHash: null,
      kind: "run-created", requestFingerprint: "7".repeat(64),
    };
    await insertCheckpoint(knex, "checkpoint-post-intent-1", created);
    await insertCheckpoint(knex, "checkpoint-post-intent-2", {
      schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
      runId: created.runId, stepId: created.stepId, attemptId: created.attemptId,
      sequence: 2, runVersion: 2, lastCommittedStepId: null,
      predecessorCheckpointId: "checkpoint-post-intent-1", predecessorPayloadHash: hashCheckpointPayload(created),
      kind: "model-call-intent", invocationFingerprint, resolvedTargetFingerprint: "9".repeat(64),
    });

    const context = { knex, dataRoot: directory, databaseFile: path.join(directory, "db.sqlite") };
    await recoverInterruptedWork(context);

    const run = await knex("o_agentRun").where("id", "run-post-intent").first();
    assert.equal(run.status, "waiting");
    assert.equal(run.waitingReason, "interrupted-model-call");
    assert.equal((await knex("o_agentRunAttempt").where("runId", run.id)).length, 1);
    assert.equal((await knex("o_agentRunAttempt").where("runId", run.id).first()).status, "waiting");
    assert.equal((await knex("o_agentRunCheckpoint").where("runId", run.id)).length, 2);
    const diagnostic = JSON.parse(run.failureDiagnostic);
    assert.equal(diagnostic.certainty, "unknown-effect");
    assert.equal(diagnostic.retryDisposition, "reconcile-first");
  } finally {
    await dispose(directory, knex);
  }
});

test("corrupt checkpoint evidence fails closed without blocking another Run recovery", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);
    for (const suffix of ["corrupt", "legacy"]) {
      await knex("o_agentRun").insert({
        id: `run-${suffix}`, projectId: 7, role: "projectAgent", scope: "read-only-summary",
        clientRequestId: `request-${suffix}`, requestFingerprint: (suffix === "corrupt" ? "a" : "b").repeat(64),
        input: JSON.stringify({ content: "safe request" }), status: "queued",
        allowedActions: JSON.stringify(["inspect"]), version: 1, createdAt: 100, updatedAt: 100,
      });
      await knex("o_agentRunStep").insert({
        id: `step-${suffix}`, runId: `run-${suffix}`, ordinal: 1, kind: "model",
        logicalTarget: "universalAi", promptFingerprint: "c".repeat(64), status: "pending",
      });
    }
    await knex("o_agentRunAttempt").insert({
      id: "attempt-corrupt", runId: "run-corrupt", stepId: "step-corrupt",
      ordinal: 1, reason: "initial", status: "preparing", createdAt: 100,
    });
    const corruptPayload: AgentRunCheckpointPayload = {
      schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
      runId: "run-corrupt", stepId: "step-corrupt", attemptId: "attempt-corrupt",
      sequence: 1, runVersion: 1, lastCommittedStepId: null,
      predecessorCheckpointId: null, predecessorPayloadHash: null,
      kind: "run-created", requestFingerprint: "a".repeat(64),
    };
    await insertCheckpoint(knex, "checkpoint-corrupt", corruptPayload);
    await knex.raw("DROP TRIGGER o_agentRunCheckpoint_prevent_update");
    await knex("o_agentRunCheckpoint").where("id", "checkpoint-corrupt").update({ payloadHash: "0".repeat(64) });

    const context = { knex, dataRoot: directory, databaseFile: path.join(directory, "db.sqlite") };
    await recoverInterruptedWork(context);

    const corrupt = await knex("o_agentRun").where("id", "run-corrupt").first();
    assert.equal(corrupt.status, "waiting");
    assert.equal(corrupt.waitingReason, "agent-checkpoint-corrupt");
    assert.equal(JSON.parse(corrupt.failureDiagnostic).failureClass, "Artifact");
    const legacy = await knex("o_agentRun").where("id", "run-legacy").first();
    assert.equal(legacy.status, "waiting", "per-Run recovery continues after corrupt evidence fails closed");
    assert.equal(legacy.waitingReason, "interrupted-before-model-call");
  } finally {
    await dispose(directory, knex);
  }
});

test("an incompatible terminal checkpoint adds idempotent attention without rewriting committed state", async () => {
  const { directory, knex } = createTemporaryDatabase();
  try {
    await initializeSchema(knex);
    await knex("o_agentRun").insert({
      id: "run-terminal-incompatible", projectId: 7, role: "projectAgent", scope: "read-only-summary",
      clientRequestId: "request-terminal-incompatible", requestFingerprint: "d".repeat(64),
      input: JSON.stringify({ content: "safe request" }), status: "succeeded",
      allowedActions: JSON.stringify(["inspect"]), version: 3, lastCommittedStepId: "step-terminal-incompatible",
      createdAt: 100, updatedAt: 103, startedAt: 101, completedAt: 103,
    });
    await knex("o_agentRunStep").insert({
      id: "step-terminal-incompatible", runId: "run-terminal-incompatible", ordinal: 1, kind: "model",
      logicalTarget: "universalAi", promptFingerprint: "e".repeat(64), status: "succeeded", startedAt: 101, completedAt: 103,
    });
    await knex("o_agentRunAttempt").insert({
      id: "attempt-terminal-incompatible", runId: "run-terminal-incompatible", stepId: "step-terminal-incompatible",
      ordinal: 1, reason: "initial", status: "succeeded", createdAt: 100, startedAt: 101, completedAt: 103,
    });
    const payload: AgentRunCheckpointPayload = {
      schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
      runId: "run-terminal-incompatible", stepId: "step-terminal-incompatible", attemptId: "attempt-terminal-incompatible",
      sequence: 1, runVersion: 1, lastCommittedStepId: null,
      predecessorCheckpointId: null, predecessorPayloadHash: null,
      kind: "run-created", requestFingerprint: "d".repeat(64),
    };
    await insertCheckpoint(knex, "checkpoint-terminal-incompatible", payload);
    await knex.raw("DROP TRIGGER o_agentRunCheckpoint_prevent_update");
    await knex("o_agentRunCheckpoint").where("id", "checkpoint-terminal-incompatible")
      .update({ schemaVersion: "toonflow.agent-run-checkpoint.v999" });

    const context = { knex, dataRoot: directory, databaseFile: path.join(directory, "db.sqlite") };
    await recoverInterruptedWork(context);
    const first = await knex("o_agentRun").where("id", "run-terminal-incompatible").first();
    await recoverInterruptedWork(context);
    const second = await knex("o_agentRun").where("id", "run-terminal-incompatible").first();

    assert.equal(second.status, "succeeded");
    assert.equal(second.completedAt, 103);
    assert.equal(second.lastCommittedStepId, "step-terminal-incompatible");
    assert.equal(second.attentionReason, "agent-checkpoint-incompatible");
    assert.equal(second.version, 4);
    assert.equal(second.updatedAt, first.updatedAt, "the same incompatibility does not append attention twice");
    assert.equal((await knex("o_agentTrace").where("runId", second.id)).length, 1);
    const diagnostic = JSON.parse(second.failureDiagnostic);
    assert.equal(diagnostic.attributes.operation, "agent-checkpoint-incompatible");
    assert.equal(JSON.stringify(diagnostic).includes("v999"), false);
    assert.equal((await knex("o_agentRunStep").where("id", "step-terminal-incompatible").first()).status, "succeeded");
    assert.equal((await knex("o_agentRunAttempt").where("id", "attempt-terminal-incompatible").first()).status, "succeeded");
  } finally {
    await dispose(directory, knex);
  }
});
