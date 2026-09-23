import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import {
  AgentRunConflictError,
  AgentRunCommandConflictError,
  AgentRunContentRejectedError,
  AgentRunEvidenceCorruptError,
  AgentRunLeaseLostError,
  AgentRunStateConflictError,
  AgentRunVersionConflictError,
  assertAgentRunStepTransition,
  assertAgentRunTransition,
  createAgentRuntime,
  projectAgentRunToChatMessage,
  type AgentRunDependencies,
} from "../src/agentRuntime";
import { recoverInterruptedAgentRuns } from "../src/database/agentRunRecovery";

async function createDatabase(filename = ":memory:"): Promise<Knex> {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename }, useNullAsDefault: true });
  await db.raw("PRAGMA busy_timeout = 5000");
  await db.schema.createTable("o_project", (table) => {
    table.integer("id").primary();
    table.text("name");
    table.text("type");
    table.text("intro");
    table.text("artStyle");
    table.text("videoRatio");
  });
  await db.schema.createTable("o_novel", (table) => {
    table.integer("id").primary();
    table.integer("projectId").notNullable();
    table.integer("chapterIndex");
    table.text("chapter");
    table.text("chapterData");
  });
  await db.schema.createTable("o_event", (table) => {
    table.integer("id").primary(); table.text("name"); table.text("detail");
  });
  await db.schema.createTable("o_eventChapter", (table) => {
    table.integer("id").primary(); table.integer("novelId"); table.integer("eventId");
  });
  await db.schema.createTable("o_agentRun", (table) => {
    table.text("id").primary();
    table.integer("projectId").notNullable();
    table.integer("scriptId");
    table.text("role").notNullable();
    table.text("scope").notNullable();
    table.text("clientRequestId").notNullable();
    table.text("requestFingerprint").notNullable();
    table.text("input").notNullable();
    table.text("status").notNullable();
    table.text("waitingReason");
    table.text("attentionReason");
    table.text("allowedActions").notNullable();
    table.text("failureDiagnostic");
    table.text("lastCommittedStepId");
    table.text("leaseOwnerId");
    table.text("leaseEpoch");
    table.integer("leaseExpiresAt");
    table.integer("fence").notNullable().defaultTo(0);
    table.integer("cancellationRequestedAt");
    table.text("cancellationCommandId");
    table.integer("version").notNullable();
    table.integer("createdAt").notNullable();
    table.integer("updatedAt").notNullable();
    table.integer("startedAt");
    table.integer("completedAt");
    table.unique(["projectId", "role", "scope", "clientRequestId"]);
  });
  await db.schema.createTable("o_agentRunCommand", (table) => {
    table.text("id").primary();
    table.text("runId").notNullable();
    table.text("clientCommandId").notNullable();
    table.text("kind").notNullable();
    table.text("inputFingerprint").notNullable();
    table.integer("expectedVersion").notNullable();
    table.integer("resultVersion").notNullable();
    table.integer("createdAt").notNullable();
    table.unique(["runId", "clientCommandId"]);
  });
  await db.schema.createTable("o_agentToolDefinition", (table) => {
    table.text("id").primary(); table.text("name"); table.text("revision"); table.text("contractHash");
    table.text("policy"); table.integer("createdAt"); table.unique(["name", "revision"]);
  });
  await db.schema.createTable("o_agentToolReceipt", (table) => {
    table.text("id").primary(); table.text("runId"); table.text("operationId"); table.text("toolName");
    table.text("toolRevision"); table.text("inputHash"); table.text("status"); table.text("outputJson");
    table.text("outputHash"); table.text("diagnostic"); table.integer("createdAt"); table.integer("updatedAt");
    table.unique(["runId", "operationId"]);
  });
  await db.schema.createTable("o_agentRunStep", (table) => {
    table.text("id").primary();
    table.text("runId").notNullable();
    table.integer("ordinal").notNullable();
    table.text("kind").notNullable();
    table.text("status").notNullable();
    table.text("logicalTarget").notNullable();
    table.text("resolvedTarget");
    table.text("promptFingerprint").notNullable();
    table.integer("startedAt");
    table.integer("completedAt");
    table.unique(["runId", "ordinal"]);
  });
  await db.schema.createTable("o_agentRunOutput", (table) => {
    table.text("id").primary();
    table.text("runId").notNullable();
    table.text("stepId").notNullable();
    table.text("kind").notNullable();
    table.text("content").notNullable();
    table.text("contentHash").notNullable();
    table.text("schemaVersion").notNullable();
    table.integer("createdAt").notNullable();
    table.unique(["runId", "stepId"]);
  });
  await db.schema.createTable("o_agentRunAttempt", (table) => {
    table.text("id").primary();
    table.text("runId").notNullable();
    table.text("stepId").notNullable();
    table.integer("ordinal").notNullable();
    table.text("predecessorAttemptId");
    table.text("reason").notNullable();
    table.text("status").notNullable();
    table.text("resolvedTarget");
    table.text("invocationFingerprint");
    table.integer("createdAt").notNullable();
    table.integer("startedAt");
    table.integer("completedAt");
    table.unique(["runId", "stepId", "ordinal"]);
  });
  await db.schema.createTable("o_agentRunCheckpoint", (table) => {
    table.text("id").primary();
    table.text("runId").notNullable();
    table.text("stepId").notNullable();
    table.text("attemptId").notNullable();
    table.integer("sequence").notNullable();
    table.text("kind").notNullable();
    table.text("schemaVersion").notNullable();
    table.integer("runVersion").notNullable();
    table.text("lastCommittedStepId");
    table.text("predecessorCheckpointId");
    table.text("payload").notNullable();
    table.text("payloadHash").notNullable();
    table.integer("createdAt").notNullable();
    table.unique(["runId", "sequence"]);
  });
  await db.schema.createTable("o_agentTrace", (table) => {
    table.text("id").primary();
    table.text("runId").notNullable();
    table.text("stepId");
    table.text("attemptId");
    table.text("toolReceiptId");
    table.text("toolCallId");
    table.text("vendorRequestId");
    table.text("imageArtifactId");
    table.text("predecessorTraceId");
    table.integer("sequence").notNullable();
    table.text("eventType").notNullable();
    table.text("runStatus");
    table.text("stepStatus");
    table.text("diagnosticSchemaVersion");
    table.text("diagnostic");
    table.integer("createdAt").notNullable();
    table.unique(["runId", "sequence"]);
  });
  await db("o_project").insert({ id: 7, name: "北境", type: "奇幻", intro: "远征", artStyle: "水墨", videoRatio: "16:9" });
  await db("o_novel").insert([
    { id: 1, projectId: 7, chapterIndex: 1, chapter: "开篇", chapterData: "可读取的小说正文" },
    { id: 2, projectId: 7, chapterIndex: 2, chapter: "续篇", chapterData: "第二章正文" },
  ]);
  return db;
}

function makeHarness(
  db: Knex,
  model: () => Promise<string> = async () => "只读建议",
  idPrefix = "id",
  overrides: Partial<AgentRunDependencies> = {},
) {
  const queue: Array<() => Promise<void>> = [];
  let serial = 0;
  let calls = 0;
  const dependencies: AgentRunDependencies = {
    work: async (operation) => operation(db),
    now: () => 1_700_000_000_000 + serial,
    createId: () => `${idPrefix}-${++serial}`,
    schedule: (work) => queue.push(work),
    openTextCall: async () => ({
      target: { vendorId: "fake", modelId: "text-v1", temperature: 2, maxOutputTokens: 256 },
      invokeText: async () => {
        calls += 1;
        return { text: await model() } as any;
      },
    }),
    ...overrides,
  };
  const runtime = createAgentRuntime(dependencies);
  return {
    runtime,
    calls: () => calls,
    flush: async () => {
      while (queue.length) await queue.shift()!();
    },
  };
}

const startInput = {
  schemaVersion: "toonflow.agent-run.start.v1" as const,
  projectId: 7,
  role: "scriptAgent" as const,
  scope: "read-only-project-guidance-v1" as const,
  clientRequestId: "request-1",
  content: "请给出项目风险摘要",
};

test("identical starts return one durable Agent Run and execute one Model Step", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    const first = await harness.runtime.start(startInput);
    const second = await harness.runtime.start({
      ...startInput,
      clientRequestId: `  ${startInput.clientRequestId}  `,
      content: `  ${startInput.content}  `,
    });
    assert.equal(first.id, second.id);
    assert.equal(first.status, "queued");
    assert.deepEqual(first.allowedActions, ["inspect", "cancel"]);
    await harness.flush();
    const completed = await harness.runtime.inspect({ runId: first.id, projectId: 7 });
    assert.equal(completed?.status, "succeeded");
    assert.equal(completed?.outputs[0]?.content, "只读建议");
    assert.equal(completed?.lastCommittedStepId, completed?.steps[0]?.id);
    assert.deepEqual(completed?.attempts.map(({ ordinal, status }) => ({ ordinal, status })), [{ ordinal: 1, status: "succeeded" }]);
    assert.deepEqual(completed?.checkpoints.map((checkpoint) => checkpoint.kind), ["run-created", "model-call-intent", "step-committed"]);
    assert.equal(completed?.checkpoints.some((checkpoint) => "payload" in checkpoint), false);
    const restarted = await harness.runtime.start(startInput);
    await harness.flush();
    assert.equal(restarted.id, first.id);
    assert.equal(harness.calls(), 1);
  } finally {
    await db.destroy();
  }
});

test("inspection quarantines a broken Trace predecessor instead of presenting a false timeline", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    const started = await harness.runtime.start(startInput);
    await harness.flush();
    await db("o_agentTrace").where({ runId: started.id, sequence: 2 })
      .update({ predecessorTraceId: "wrong-trace" });
    const snapshot = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    assert.equal(snapshot?.traceEvidence.linkage, "corrupt");
    assert.equal(snapshot?.traceEvidence.ordering, "durable-sequence");
    assert.deepEqual(snapshot?.traces, []);
    assert.equal(snapshot?.status, "succeeded", "Run state remains independently inspectable");
  } finally { await db.destroy(); }
});

test("the read-only Agent Run invokes novel Tools only through controlled receipts", async () => {
  const db = await createDatabase();
  let observedToolOutput: unknown;
  try {
    const harness = makeHarness(db, undefined, "tool-integration", {
      openTextCall: async () => ({
        target: { vendorId: "fake", modelId: "text-v1" },
        invokeText: async (input) => {
          const facts = (input.messages as Array<{ content: string }>)[1].content;
          assert.match(facts, /1:1、2:2/u, "the model receives authorized chapter IDs");
          const read = (input.tools as any).get_novel_text;
          observedToolOutput = await read.execute({ novelId: 1 }, { toolCallId: "novel-call-1" });
          return { text: "已依据原文给出只读建议" } as any;
        },
      }),
    });
    const started = await harness.runtime.start(startInput);
    await harness.flush();
    assert.deepEqual(observedToolOutput, { novelId: 1, chapterIndex: 1, chapter: "开篇", text: "可读取的小说正文" });
    const receipt = await db("o_agentToolReceipt").where("runId", started.id).first();
    assert.equal(receipt.status, "succeeded");
    assert.equal(receipt.toolName, "get_novel_text");
    const snapshot = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    assert.equal(snapshot?.status, "succeeded");
    assert.deepEqual(snapshot?.traces.map((trace) => trace.eventType), [
      "run.created", "run.started", "tool.started", "tool.succeeded", "run.succeeded",
    ]);
    assert.equal(snapshot?.traces.find((trace) => trace.eventType === "tool.succeeded")?.toolReceiptId, receipt.id);
    assert.equal(JSON.stringify(snapshot?.traces).includes("小说正文"), false);
  } finally { await db.destroy(); }
});

test("queued cancellation commits intent and terminal state once before any Provider call", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    const started = await harness.runtime.start(startInput);
    const command = { runId: started.id, projectId: 7, clientCommandId: "cancel-1", expectedVersion: started.version };
    const cancelled = await harness.runtime.cancel(command);
    assert.equal(cancelled?.status, "cancelled");
    assert.equal(cancelled?.steps[0]?.status, "cancelled");
    assert.equal(cancelled?.attempts[0]?.status, "cancelled");
    assert.equal(cancelled?.cancellationCommandId, "cancel-1");
    await harness.flush();
    assert.equal(harness.calls(), 0);
    const duplicate = await harness.runtime.cancel(command);
    assert.equal(duplicate?.version, cancelled?.version);
    assert.equal((await db("o_agentRunCommand").where("runId", started.id)).length, 1);
    await assert.rejects(harness.runtime.cancel({ ...command, expectedVersion: cancelled!.version }), AgentRunCommandConflictError);
  } finally {
    await db.destroy();
  }
});

test("an in-flight cancellation remains intent, and a stale client version cannot overwrite it", async () => {
  const db = await createDatabase();
  let release!: (value: string) => void;
  const provider = new Promise<string>((resolve) => { release = resolve; });
  try {
    const harness = makeHarness(db, () => provider);
    const started = await harness.runtime.start(startInput);
    const executing = harness.flush();
    while (harness.calls() === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    const running = (await harness.runtime.inspect({ runId: started.id, projectId: 7 }))!;
    assert.deepEqual(running.allowedActions, ["inspect", "cancel"]);
    await assert.rejects(harness.runtime.cancel({
      runId: started.id, projectId: 7, clientCommandId: "stale", expectedVersion: started.version,
    }), AgentRunVersionConflictError);
    const requested = (await harness.runtime.cancel({
      runId: started.id, projectId: 7, clientCommandId: "cancel-in-flight", expectedVersion: running.version,
    }))!;
    assert.equal(requested.status, "running", "intent is not false confirmation of cancellation");
    assert.equal(requested.cancellationCommandId, "cancel-in-flight");
    await assert.rejects(harness.runtime.cancel({
      runId: started.id, projectId: 7, clientCommandId: "second-cancel", expectedVersion: requested.version,
    }), AgentRunVersionConflictError, "the first accepted cancellation intent remains stable");
    release("只读建议");
    await executing;
    const settled = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    assert.equal(settled?.status, "succeeded", "a completed in-flight effect is retained");
    assert.equal(settled?.cancellationCommandId, "cancel-in-flight");
    assert.equal(settled?.outputs[0]?.content, "只读建议");
    assert.equal(harness.calls(), 1);
  } finally {
    await db.destroy();
  }
});

test("a long Provider call renews its lease without advancing Run version", async () => {
  const db = await createDatabase();
  let release!: (value: string) => void;
  const provider = new Promise<string>((resolve) => { release = resolve; });
  try {
    const harness = makeHarness(db, () => provider, "heartbeat", { now: Date.now, leaseDurationMs: 120 });
    const started = await harness.runtime.start(startInput);
    const executing = harness.flush();
    while (harness.calls() === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    const initial = (await harness.runtime.inspect({ runId: started.id, projectId: 7 }))!;
    await new Promise<void>((resolve) => setTimeout(resolve, 260));
    const renewed = (await harness.runtime.inspect({ runId: started.id, projectId: 7 }))!;
    assert.equal(renewed.status, "running");
    assert.equal(renewed.version, initial.version);
    assert.ok(renewed.leaseExpiresAt! > initial.leaseExpiresAt!, "heartbeat extends the same fenced lease");
    release("只读建议");
    await executing;
    assert.equal((await harness.runtime.inspect({ runId: started.id, projectId: 7 }))?.status, "succeeded");
  } finally {
    release?.("只读建议");
    await db.destroy();
  }
});

test("an expired worker cannot commit a late Provider result after recovery fences it out", async () => {
  const db = await createDatabase();
  let release!: (value: string) => void;
  const provider = new Promise<string>((resolve) => { release = resolve; });
  try {
    const harness = makeHarness(db, () => provider);
    const started = await harness.runtime.start(startInput);
    const executing = harness.flush();
    while (harness.calls() === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    const running = (await harness.runtime.inspect({ runId: started.id, projectId: 7 }))!;
    await recoverInterruptedAgentRuns(db, running.leaseExpiresAt!);
    release("迟到的 Provider 结果");
    await assert.rejects(executing, AgentRunLeaseLostError);
    const recovered = (await harness.runtime.inspect({ runId: started.id, projectId: 7 }))!;
    assert.equal(recovered.status, "waiting");
    assert.equal(recovered.waitingReason, "interrupted-model-call");
    assert.equal(recovered.outputs.length, 0, "stale worker cannot commit its late result");
    assert.equal(recovered.checkpoints.at(-1)?.kind, "model-call-intent");
  } finally {
    release?.("迟到的 Provider 结果");
    await db.destroy();
  }
});

test("refresh lists the current Run and exactly twenty deterministic recent Runs within one Project scope", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    const ids: string[] = [];
    for (let index = 0; index < 22; index += 1) {
      const started = await harness.runtime.start({ ...startInput, clientRequestId: `request-${index}` });
      ids.push(started.id);
    }
    const listed = await harness.runtime.list({ projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1" });
    assert.equal(listed.recent.length, 20);
    assert.equal(listed.current?.id, ids.at(-1));
    assert.deepEqual(listed.recent.map((item) => item.id), ids.slice(-20).reverse());
    const other = await harness.runtime.list({ projectId: 8, role: "scriptAgent", scope: "read-only-project-guidance-v1" });
    assert.deepEqual(other, { current: null, recent: [] });
  } finally {
    await db.destroy();
  }
});

test("a fresh Runtime reprojects persisted Run state without the original scheduler or Socket", async () => {
  const db = await createDatabase();
  try {
    const original = makeHarness(db, async () => "不应调用", "original");
    const started = await original.runtime.start(startInput);
    const reconnected = makeHarness(db, async () => "不应调用", "reconnected");
    const listed = await reconnected.runtime.list({ projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1" });
    assert.equal(listed.current?.id, started.id);
    assert.equal(listed.current?.version, started.version);
    const cancelled = await reconnected.runtime.cancel({
      runId: started.id, projectId: 7, clientCommandId: "reconnected-cancel", expectedVersion: listed.current!.version,
    });
    assert.equal(cancelled?.status, "cancelled");
    await original.flush();
    assert.equal(original.calls(), 0, "a disconnected scheduler cannot revive the cancelled Run");
    assert.equal((await reconnected.runtime.inspect({ runId: started.id, projectId: 7 }))?.status, "cancelled");
  } finally {
    await db.destroy();
  }
});

test("same idempotency key with a different request is rejected", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    await harness.runtime.start(startInput);
    await assert.rejects(
      harness.runtime.start({ ...startInput, content: "另一条指令" }),
      AgentRunConflictError,
    );
  } finally {
    await db.destroy();
  }
});

test("concurrent identical starts schedule only one execution", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    const [first, second] = await Promise.all([
      harness.runtime.start(startInput),
      harness.runtime.start(startInput),
    ]);
    assert.equal(first.id, second.id);
    await harness.flush();
    assert.equal(harness.calls(), 1);
  } finally {
    await db.destroy();
  }
});

test("two SQLite connections resolve a concurrent identical start to one Run", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-agent-run-race-"));
  const filename = path.join(directory, "db.sqlite");
  const firstDb = await createDatabase(filename);
  const secondDb = knexFactory({ client: "better-sqlite3", connection: { filename }, useNullAsDefault: true });
  await Promise.all([firstDb.raw("PRAGMA busy_timeout = 10"), secondDb.raw("PRAGMA busy_timeout = 10")]);
  try {
    const firstHarness = makeHarness(firstDb, async () => "只读建议", "first");
    const secondHarness = makeHarness(secondDb, async () => "只读建议", "second");
    const [first, second] = await Promise.all([
      firstHarness.runtime.start(startInput),
      secondHarness.runtime.start(startInput),
    ]);
    assert.equal(first.id, second.id);
    await Promise.all([firstHarness.flush(), secondHarness.flush()]);
    assert.equal(firstHarness.calls() + secondHarness.calls(), 1);
  } finally {
    await Promise.all([firstDb.destroy(), secondDb.destroy()]);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a missing Project is rejected before any Run record is written", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    await assert.rejects(harness.runtime.start({ ...startInput, projectId: 404 }), /Project 404 不存在/u);
    const row = await db("o_agentRun").first();
    assert.equal(row, undefined);
  } finally {
    await db.destroy();
  }
});

test("the initial Run, Step, and Trace creation is atomic", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    await db.raw(`CREATE TRIGGER reject_created_trace BEFORE INSERT ON o_agentTrace
      WHEN NEW.eventType = 'run.created' BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    await assert.rejects(harness.runtime.start(startInput), /injected/u);
    assert.equal(await db("o_agentRun").first(), undefined);
    assert.equal(await db("o_agentRunStep").first(), undefined);
    assert.equal(await db("o_agentRunAttempt").first(), undefined);
    assert.equal(await db("o_agentRunCheckpoint").first(), undefined);
  } finally {
    await db.destroy();
  }
});

test("inspect is a pure read and remains project-scoped", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    const started = await harness.runtime.start(startInput);
    const before = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    const traceCount = await db("o_agentTrace").count<{ count: number }[]>("id as count").first();
    const again = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    const afterCount = await db("o_agentTrace").count<{ count: number }[]>("id as count").first();
    assert.deepEqual(again, before);
    assert.equal(Number(afterCount?.count), Number(traceCount?.count));
    assert.equal(await harness.runtime.inspect({ runId: started.id, projectId: 99 }), null);
  } finally {
    await db.destroy();
  }
});

test("a legacy T04 succeeded Run remains inspectable after the T05 schema upgrade", async () => {
  const db = await createDatabase();
  try {
    const content = "旧版只读建议";
    const contentHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
    await db("o_agentRun").insert({
      id: "legacy-run", projectId: 7, scriptId: null, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "legacy-request", requestFingerprint: "legacy-fingerprint", input: JSON.stringify({ content: "旧版请求" }),
      status: "succeeded", waitingReason: null, attentionReason: null, allowedActions: JSON.stringify(["inspect"]),
      failureDiagnostic: null, lastCommittedStepId: null, version: 3, createdAt: 100, updatedAt: 102, startedAt: 101, completedAt: 102,
    });
    await db("o_agentRunStep").insert({
      id: "legacy-step", runId: "legacy-run", ordinal: 1, kind: "model", status: "succeeded",
      logicalTarget: JSON.stringify({ kind: "logical", key: "scriptAgent:decisionAgent" }),
      resolvedTarget: JSON.stringify({ vendorId: "fake", modelId: "text-v1", temperature: 2, maxOutputTokens: 256 }),
      promptFingerprint: "legacy-prompt", startedAt: 101, completedAt: 102,
    });
    await db("o_agentRunOutput").insert({
      id: "legacy-output", runId: "legacy-run", stepId: "legacy-step", kind: "assistant-text",
      content, contentHash, schemaVersion: "toonflow.agent-run-output.v1", createdAt: 102,
    });
    await db("o_agentTrace").insert([
      { id: "legacy-trace-1", runId: "legacy-run", stepId: "legacy-step", sequence: 1, eventType: "run.created", runStatus: "queued", stepStatus: "pending", createdAt: 100 },
      { id: "legacy-trace-2", runId: "legacy-run", stepId: "legacy-step", sequence: 2, eventType: "run.started", runStatus: "running", stepStatus: "running", createdAt: 101 },
      { id: "legacy-trace-3", runId: "legacy-run", stepId: "legacy-step", sequence: 3, eventType: "run.succeeded", runStatus: "succeeded", stepStatus: "succeeded", createdAt: 102 },
    ]);
    const harness = makeHarness(db);
    const snapshot = await harness.runtime.inspect({ runId: "legacy-run", projectId: 7 });
    assert.equal(snapshot?.status, "succeeded");
    assert.equal(snapshot?.outputs[0]?.content, content);
    assert.deepEqual(snapshot?.attempts, []);
    assert.deepEqual(snapshot?.checkpoints, []);

    await db("o_agentRunOutput").where("id", "legacy-output").update({ content: "被篡改" });
    await assert.rejects(harness.runtime.inspect({ runId: "legacy-run", projectId: 7 }), AgentRunEvidenceCorruptError);
  } finally {
    await db.destroy();
  }
});

test("checkpoint summaries are ordered, hash-linked, and fail closed after envelope tampering", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    const started = await harness.runtime.start(startInput);
    await harness.flush();
    const snapshot = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    assert.deepEqual(snapshot?.checkpoints.map((checkpoint) => checkpoint.sequence), [1, 2, 3]);
    assert.equal(snapshot?.checkpoints[1]?.predecessorCheckpointId, snapshot?.checkpoints[0]?.id);
    assert.equal(snapshot?.checkpoints[2]?.predecessorCheckpointId, snapshot?.checkpoints[1]?.id);
    await db("o_agentRunCheckpoint").where({ runId: started.id, sequence: 2 }).update({ runVersion: 99 });
    await assert.rejects(harness.runtime.inspect({ runId: started.id, projectId: 7 }), AgentRunEvidenceCorruptError);
  } finally {
    await db.destroy();
  }
});

test("a quarantined terminal Run remains inspectable without projecting untrusted output", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    const started = await harness.runtime.start(startInput);
    await harness.flush();
    await db("o_agentRunCheckpoint").where({ runId: started.id, sequence: 3 }).update({ payloadHash: "0".repeat(64) });
    await recoverInterruptedAgentRuns(db);
    const snapshot = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    assert.equal(snapshot?.status, "succeeded", "committed lifecycle is not rewritten");
    assert.equal(snapshot?.attentionReason, "agent-checkpoint-corrupt");
    assert.deepEqual(snapshot?.outputs, [], "untrusted output is not projected");
    assert.deepEqual(snapshot?.checkpoints, [], "untrusted checkpoint metadata is not projected");
    const message = projectAgentRunToChatMessage(snapshot!);
    assert.equal(message.ext?.agentRun.displayStatus, "needs-attention");
    assert.equal(message.status, "pending");
    assert.equal(JSON.stringify(message).includes("只读建议"), false);
  } finally {
    await db.destroy();
  }
});

test("deleted checkpoint history on a T05 terminal Run is quarantined, not mistaken for T04", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    const started = await harness.runtime.start(startInput);
    await harness.flush();
    await db("o_agentRunCheckpoint").where("runId", started.id).del();
    await recoverInterruptedAgentRuns(db);
    const snapshot = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    assert.equal(snapshot?.status, "succeeded");
    assert.equal(snapshot?.attentionReason, "agent-checkpoint-corrupt");
    assert.deepEqual(snapshot?.outputs, []);
  } finally {
    await db.destroy();
  }
});

test("model-call intent is durable before invocation and partial provider work is not a checkpoint", async () => {
  const db = await createDatabase();
  let release!: (value: string) => void;
  const provider = new Promise<string>((resolve) => { release = resolve; });
  try {
    const harness = makeHarness(db, () => provider);
    const started = await harness.runtime.start(startInput);
    const executing = harness.flush();
    while (harness.calls() === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    const inFlight = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    assert.equal(inFlight?.status, "running");
    assert.deepEqual(inFlight?.checkpoints.map((checkpoint) => checkpoint.kind), ["run-created", "model-call-intent"]);
    assert.equal(inFlight?.outputs.length, 0);
    release("只读建议");
    await executing;
    const completed = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    assert.deepEqual(completed?.checkpoints.map((checkpoint) => checkpoint.kind), ["run-created", "model-call-intent", "step-committed"]);
  } finally {
    await db.destroy();
  }
});

test("a rejected intent commit has known-no-effect semantics and never invokes the provider", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    const started = await harness.runtime.start(startInput);
    await db.raw(`CREATE TRIGGER reject_intent_checkpoint BEFORE INSERT ON o_agentRunCheckpoint
      WHEN NEW.kind = 'model-call-intent' BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    await harness.flush();
    const failed = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.attempts[0]?.status, "failed");
    assert.equal(failed?.traces.at(-1)?.diagnostic?.certainty, "known-no-effect");
    assert.equal(harness.calls(), 0);
    assert.deepEqual(failed?.checkpoints.map((checkpoint) => checkpoint.kind), ["run-created"]);
  } finally {
    await db.destroy();
  }
});

test("a provider failure after intent waits for reconciliation and stores only a Trace-safe diagnostic", async () => {
  const db = await createDatabase();
  try {
    const secret = "sk_forbidden_provider_message";
    const harness = makeHarness(db, async () => { throw new Error(secret); });
    const started = await harness.runtime.start(startInput);
    await harness.flush();
    const failed = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    assert.equal(failed?.status, "waiting");
    assert.equal(failed?.attentionReason, "model-call-outcome-unknown");
    assert.equal(failed?.attempts[0]?.status, "waiting");
    assert.equal(failed?.outputs.length, 0);
    assert.deepEqual(failed?.steps[0]?.resolvedTarget, {
      vendorId: "fake", modelId: "text-v1", temperature: 2, maxOutputTokens: 256,
    });
    const serialized = JSON.stringify(failed);
    assert.equal(serialized.includes(secret), false);
    assert.match(serialized, /toonflow\.trace-safe-diagnostic\.v1/u);
  } finally {
    await db.destroy();
  }
});

test("a Project fact read failure is classified as retryable Context execution failure", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    const started = await harness.runtime.start(startInput);
    await db.schema.dropTable("o_novel");
    await harness.flush();
    const failed = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    const diagnostic = failed?.traces.at(-1)?.diagnostic;
    assert.equal(diagnostic?.failureClass, "Context");
    assert.equal(diagnostic?.kind, "executionFailed");
    assert.equal(diagnostic?.retryDisposition, "safe-retry");
  } finally {
    await db.destroy();
  }
});

test("Run input and final output reject credentials before durable persistence", async () => {
  const db = await createDatabase();
  try {
    const inputHarness = makeHarness(db);
    await assert.rejects(
      inputHarness.runtime.start({ ...startInput, content: "请使用 sk_forbidden_input_secret" }),
      AgentRunContentRejectedError,
    );
    assert.equal(await db("o_agentRun").first(), undefined);

    const outputHarness = makeHarness(db, async () => "模型误返回 sk_forbidden_output_secret");
    const started = await outputHarness.runtime.start({ ...startInput, clientRequestId: "output-secret" });
    await outputHarness.flush();
    const failed = await outputHarness.runtime.inspect({ runId: started.id, projectId: 7 });
    assert.equal(failed?.status, "waiting");
    assert.equal(failed?.outputs.length, 0);
    assert.equal(JSON.stringify(failed).includes("sk_forbidden_output_secret"), false);
    assert.equal(failed?.traces.at(-1)?.diagnostic?.failureClass, "Artifact");
    assert.equal(failed?.traces.at(-1)?.diagnostic?.kind, "redactionFailed");
  } finally {
    await db.destroy();
  }
});

test("inspect fails closed when a persisted diagnostic is corrupted", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db, async () => { throw new Error("safe failure"); });
    const started = await harness.runtime.start(startInput);
    await harness.flush();
    await db("o_agentTrace").where({ runId: started.id, eventType: "run.needs-attention" }).update({
      diagnostic: JSON.stringify({ schemaVersion: "toonflow.trace-safe-diagnostic.v1", audience: "trace", secret: "leak" }),
    });
    await assert.rejects(
      harness.runtime.inspect({ runId: started.id, projectId: 7 }),
      AgentRunEvidenceCorruptError,
    );
  } finally {
    await db.destroy();
  }
});

test("lifecycle guards reject terminal rewrites and allow the recovery transitions", () => {
  assert.doesNotThrow(() => assertAgentRunTransition("queued", "running"));
  assert.doesNotThrow(() => assertAgentRunTransition("running", "waiting"));
  assert.doesNotThrow(() => assertAgentRunStepTransition("pending", "waiting"));
  assert.throws(() => assertAgentRunTransition("succeeded", "running"), AgentRunStateConflictError);
  assert.throws(() => assertAgentRunStepTransition("failed", "running"), AgentRunStateConflictError);
});

test("terminal commit failure rolls back output and pauses unknown-effect work for attention", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    const started = await harness.runtime.start(startInput);
    await db.raw(`CREATE TRIGGER reject_success_trace BEFORE INSERT ON o_agentTrace
      WHEN NEW.eventType = 'run.succeeded' BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    await harness.flush();
    const snapshot = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    assert.equal(snapshot?.status, "waiting");
    assert.equal(snapshot?.steps[0]?.status, "waiting");
    assert.equal(snapshot?.attempts[0]?.status, "waiting");
    assert.equal(snapshot?.attentionReason, "model-call-outcome-unknown");
    assert.equal(snapshot?.outputs.length, 0);
    assert.equal(snapshot?.traces.at(-1)?.diagnostic?.failureClass, "Artifact");
    assert.equal(snapshot?.traces.at(-1)?.diagnostic?.kind, "persistenceFailed");
  } finally {
    await db.destroy();
  }
});

test("UI projection uses durable ids and shows attention as needs-attention", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    const started = await harness.runtime.start(startInput);
    const waiting = { ...started, status: "waiting" as const, attentionReason: "interrupted-model-call" };
    const message = projectAgentRunToChatMessage(waiting);
    assert.equal(message.id, started.id);
    assert.equal(message.content?.[0]?.id, `${started.id}:status`);
    assert.equal(message.ext?.agentRun.displayStatus, "needs-attention");
  } finally {
    await db.destroy();
  }
});
