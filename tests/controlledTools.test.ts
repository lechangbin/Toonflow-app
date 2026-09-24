import assert from "node:assert/strict";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import {
  TOOL_DEFINITIONS,
  HARNESS_TOOL_DEFINITIONS,
  getControlledToolDefinition,
  toolDefinitionContractHash,
  ToolOperationConflictError,
  ToolEvidenceCorruptError,
  createControlledToolRuntime,
  type ExecuteControlledToolInput,
  type ToolAdapter,
} from "../src/controlledTools";
import { recoverPendingControlledTools } from "../src/controlledTools/recovery";

async function createDatabase(): Promise<Knex> {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_agentRun", (table) => {
    table.text("id").primary(); table.integer("projectId"); table.text("status"); table.text("role"); table.text("scope");
    table.integer("cancellationRequestedAt");
    table.text("leaseOwnerId"); table.text("leaseEpoch"); table.integer("leaseExpiresAt"); table.integer("fence");
  });
  await db.schema.createTable("o_novel", (table) => {
    table.integer("id").primary(); table.integer("projectId"); table.integer("chapterIndex");
    table.text("chapter"); table.text("chapterData");
  });
  await db.schema.createTable("o_event", (table) => {
    table.integer("id").primary(); table.text("name"); table.text("detail");
  });
  await db.schema.createTable("o_eventChapter", (table) => {
    table.integer("id").primary(); table.integer("novelId"); table.integer("eventId");
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
  await db.schema.createTable("o_agentTrace", (table) => {
    table.text("id").primary(); table.text("runId"); table.text("toolReceiptId"); table.text("predecessorTraceId");
    table.integer("sequence"); table.text("eventType"); table.text("runStatus"); table.text("diagnosticSchemaVersion");
    table.text("diagnostic"); table.integer("createdAt"); table.unique(["runId", "sequence"]);
  });
  await db("o_agentRun").insert({
    id: "run-1", projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
    status: "running", leaseOwnerId: "worker-1",
    leaseEpoch: "epoch-1", leaseExpiresAt: 200, fence: 1,
  });
  await db("o_novel").insert([
    { id: 10, projectId: 7, chapterIndex: 1, chapter: "开篇", chapterData: "一段安全的小说正文" },
    { id: 11, projectId: 8, chapterIndex: 2, chapter: "隔离", chapterData: "别的项目正文" },
  ]);
  await db("o_event").insert({ id: 21, name: "出发", detail: "主角离开家乡" });
  await db("o_eventChapter").insert({ id: 31, novelId: 10, eventId: 21 });
  return db;
}

const lease = { runId: "run-1", ownerId: "worker-1", epoch: "epoch-1", expiresAt: 200, fence: 1 };
function request(toolName: "get_novel_text" | "get_novel_events", operationId: string, novelId: number): ExecuteControlledToolInput {
  return { runId: "run-1", projectId: 7, operationId, toolName,
    revision: TOOL_DEFINITIONS[toolName].revision, input: { novelId }, lease };
}

function runtime(db: Knex, adapters?: Partial<Record<"get_novel_text" | "get_novel_events", ToolAdapter>>) {
  let counter = 0;
  return createControlledToolRuntime({
    work: async (operation) => operation(db), now: () => 100,
    createId: () => `id-${++counter}`, adapters,
  });
}

test("controlled read Tools persist bounded outputs, immutable revisions, receipts and causal Trace", async () => {
  const db = await createDatabase();
  try {
    const tools = runtime(db);
    const text = await tools.execute(request("get_novel_text", "read-text", 10));
    const events = await tools.execute(request("get_novel_events", "read-events", 10));
    assert.equal(text.status, "recorded");
    assert.equal(events.status, "recorded");
    if (text.status !== "recorded" || events.status !== "recorded") return;
    assert.equal(text.receipt.status, "succeeded");
    assert.deepEqual(text.receipt.output, { novelId: 10, chapterIndex: 1, chapter: "开篇", text: "一段安全的小说正文" });
    assert.deepEqual(events.receipt.output, { novelId: 10, truncated: false, events: [{ id: 21, name: "出发", detail: "主角离开家乡" }] });
    assert.equal((await db("o_agentToolDefinition")).length, 2);
    const traces = await db("o_agentTrace").orderBy("sequence");
    assert.deepEqual(traces.map((row) => row.sequence), [1, 2, 3, 4]);
    assert.deepEqual(traces.map((row) => row.eventType), ["tool.started", "tool.succeeded", "tool.started", "tool.succeeded"]);
    assert.deepEqual(traces.map((row) => row.predecessorTraceId), [null, traces[0].id, traces[1].id, traces[2].id]);
    assert.ok(traces.every((row) => !JSON.stringify(row).includes("小说正文")), "Trace never copies project text");
    assert.equal(traces[1].toolReceiptId, text.receipt.id);
  } finally { await db.destroy(); }
});

test("Harness read Tool uses a distinct revision and refuses an unguarded runtime", async () => {
  assert.notEqual(toolDefinitionContractHash(TOOL_DEFINITIONS.get_novel_text),
    toolDefinitionContractHash(HARNESS_TOOL_DEFINITIONS.get_novel_text));
  assert.equal(getControlledToolDefinition("get_novel_text",
    TOOL_DEFINITIONS.get_novel_text.revision)?.revision,
  TOOL_DEFINITIONS.get_novel_text.revision);
  assert.equal(getControlledToolDefinition("get_novel_text",
    HARNESS_TOOL_DEFINITIONS.get_novel_text.revision)?.revision,
  HARNESS_TOOL_DEFINITIONS.get_novel_text.revision);
  const db = await createDatabase();
  try {
    await db("o_agentRun").where({ id: "run-1" }).update({ scope: "script-harness-guidance-v1" });
    const result = await runtime(db).execute({ ...request("get_novel_text", "unguarded-v2", 10),
      revision: HARNESS_TOOL_DEFINITIONS.get_novel_text.revision });
    assert.equal(result.status, "rejected");
    assert.equal((await db("o_agentToolReceipt")).length, 0);
  } finally { await db.destroy(); }
});

test("event output is ordered, capped at twenty, and declares truncation", async () => {
  const db = await createDatabase();
  try {
    await db("o_event").insert(Array.from({ length: 21 }, (_, index) => ({
      id: 22 + index, name: `事件${index}`, detail: "受限详情",
    })));
    await db("o_eventChapter").insert(Array.from({ length: 21 }, (_, index) => ({
      id: 32 + index, novelId: 10, eventId: 22 + index,
    })));
    const result = await runtime(db).execute(request("get_novel_events", "many-events", 10));
    assert.equal(result.status, "recorded");
    if (result.status !== "recorded") return;
    assert.equal(result.receipt.status, "succeeded");
    const output = result.receipt.output as { truncated: boolean; events: Array<{ id: number }> };
    assert.equal(output.truncated, true);
    assert.equal(output.events.length, 20);
    assert.deepEqual(output.events.map((event) => event.id), Array.from({ length: 20 }, (_, index) => 21 + index));
  } finally { await db.destroy(); }
});

test("a duplicate operation returns one durable result and rejects changed input identity", async () => {
  const db = await createDatabase();
  let calls = 0;
  try {
    const tools = runtime(db, { get_novel_text: async () => {
      calls += 1; return { novelId: 10, chapterIndex: 1, chapter: "开篇", text: "安全正文" };
    } });
    const first = await tools.execute(request("get_novel_text", "dedup", 10));
    const second = await tools.execute(request("get_novel_text", "dedup", 10));
    assert.deepEqual(second, first);
    assert.equal(calls, 1);
    assert.equal((await db("o_agentToolReceipt")).length, 1);
    assert.equal((await db("o_agentTrace")).length, 2);
    await assert.rejects(tools.execute(request("get_novel_text", "dedup", 11)), ToolOperationConflictError);
  } finally { await db.destroy(); }
});

test("duplicate reads fail closed when a persisted ToolReceipt output was changed", async () => {
  const db = await createDatabase();
  try {
    const tools = runtime(db);
    await tools.execute(request("get_novel_text", "tamper", 10));
    await db("o_agentToolReceipt").where("operationId", "tamper").update({ outputJson: "{}" });
    await assert.rejects(tools.execute(request("get_novel_text", "tamper", 10)), ToolEvidenceCorruptError);
  } finally { await db.destroy(); }
});

test("duplicate reads fail closed when the persisted ToolDefinition contract changes", async () => {
  const db = await createDatabase();
  try {
    const tools = runtime(db);
    await tools.execute(request("get_novel_text", "catalog-tamper", 10));
    await db("o_agentToolDefinition").where({ name: "get_novel_text" }).update({ contractHash: "changed" });
    await assert.rejects(tools.execute(request("get_novel_text", "catalog-tamper", 10)), ToolEvidenceCorruptError);
  } finally { await db.destroy(); }
});

test("an overlapping duplicate observes the pending receipt without starting another adapter", async () => {
  const db = await createDatabase();
  let release!: (value: unknown) => void;
  let calls = 0;
  const blocked = new Promise<unknown>((resolve) => { release = resolve; });
  try {
    const tools = runtime(db, { get_novel_text: async () => { calls += 1; return blocked; } });
    const first = tools.execute(request("get_novel_text", "overlap", 10));
    while (calls === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    const duplicate = await tools.execute(request("get_novel_text", "overlap", 10));
    assert.equal(duplicate.status, "recorded");
    if (duplicate.status !== "recorded") return;
    assert.equal(duplicate.receipt.status, "pending");
    assert.equal(calls, 1);
    release({ novelId: 10, chapterIndex: 1, chapter: "开篇", text: "安全正文" });
    assert.equal((await first).status, "recorded");
    assert.equal((await db("o_agentToolReceipt")).length, 1);
  } finally { release?.({ novelId: 10, chapterIndex: 1, chapter: "开篇", text: "安全正文" }); await db.destroy(); }
});

test("cross-project novel identifiers are denied before an adapter can run", async () => {
  const db = await createDatabase();
  let calls = 0;
  try {
    const tools = runtime(db, { get_novel_text: async () => { calls += 1; throw new Error("must not run"); } });
    const denied = await tools.execute(request("get_novel_text", "cross-project", 11));
    assert.equal(denied.status, "recorded");
    if (denied.status !== "recorded") return;
    assert.equal(denied.receipt.status, "failed");
    assert.equal(denied.receipt.diagnostic?.kind, "authorizationFailed");
    assert.equal(calls, 0);
    assert.equal((await db("o_agentTrace").first()).eventType, "tool.denied");
    const wrongRunProject = await tools.execute({ ...request("get_novel_text", "wrong-project", 10), projectId: 8 });
    assert.equal(wrongRunProject.status, "rejected");
    await db("o_agentRun").where("id", "run-1").update({ role: "productionAgent" });
    const wrongRole = await tools.execute(request("get_novel_text", "wrong-role", 10));
    assert.equal(wrongRole.status, "rejected");
    await db("o_agentRun").where("id", "run-1").update({ role: "scriptAgent", cancellationRequestedAt: 100 });
    const cancelled = await tools.execute(request("get_novel_text", "after-cancel", 10));
    assert.equal(cancelled.status, "rejected", "cancellation intent stops new Tool execution");
    assert.equal((await db("o_agentToolReceipt")).length, 1, "cross-project Run lookup creates no victim record");
  } finally { await db.destroy(); }
});

test("strict input, malformed output, and adapter errors yield only safe diagnostics", async () => {
  const db = await createDatabase();
  try {
    const tools = runtime(db, {
      get_novel_text: async () => ({ novelId: 10, chapterIndex: 1, chapter: "开篇", text: "x".repeat(16_001) }),
      get_novel_events: async () => { throw new Error("private adapter failure: secret material"); },
    });
    const invalid = await tools.execute({ ...request("get_novel_text", "invalid", 10), input: { novelId: 10, projectId: 8 } });
    assert.equal(invalid.status, "rejected");
    const malformed = await tools.execute(request("get_novel_text", "malformed", 10));
    const failed = await tools.execute(request("get_novel_events", "adapter-error", 10));
    assert.equal(malformed.status, "recorded");
    assert.equal(failed.status, "recorded");
    if (malformed.status !== "recorded" || failed.status !== "recorded") return;
    assert.equal(malformed.receipt.diagnostic?.kind, "invalidOutput");
    assert.equal(failed.receipt.diagnostic?.kind, "executionFailed");
    assert.equal(JSON.stringify(await db("o_agentToolReceipt")).includes("private adapter failure"), false);
    assert.equal(JSON.stringify(await db("o_agentTrace")).includes("private adapter failure"), false);
  } finally { await db.destroy(); }
});

test("a nonresponsive read adapter records a bounded timeout diagnostic", async () => {
  const db = await createDatabase();
  try {
    const tools = runtime(db, { get_novel_text: async () => new Promise<never>(() => undefined) });
    const result = await tools.execute(request("get_novel_text", "timeout", 10));
    assert.equal(result.status, "recorded");
    if (result.status !== "recorded") return;
    assert.equal(result.receipt.status, "failed");
    assert.equal(result.receipt.diagnostic?.kind, "timeout");
    assert.equal(result.receipt.diagnostic?.retryDisposition, "safe-retry");
    assert.equal((await db("o_agentTrace").where("eventType", "tool.failed").first()).toolReceiptId, result.receipt.id);
  } finally { await db.destroy(); }
});

test("restart recovery settles an orphaned read receipt once and preserves a live lease", async () => {
  const db = await createDatabase();
  let release!: (value: unknown) => void;
  const blocked = new Promise<unknown>((resolve) => { release = resolve; });
  try {
    const tools = runtime(db, { get_novel_text: async () => blocked });
    const executing = tools.execute(request("get_novel_text", "interrupted", 10));
    while (!(await db("o_agentToolReceipt").where("operationId", "interrupted").first())) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await recoverPendingControlledTools(db, 199);
    assert.equal((await db("o_agentToolReceipt").first()).status, "pending");
    await db("o_agentRun").where("id", "run-1").update({ leaseOwnerId: null, leaseEpoch: null, leaseExpiresAt: null, status: "waiting" });
    await recoverPendingControlledTools(db, 200);
    await recoverPendingControlledTools(db, 200);
    const receipt = await db("o_agentToolReceipt").first();
    assert.equal(receipt.status, "failed");
    assert.equal(JSON.parse(receipt.diagnostic).retryDisposition, "safe-retry");
    assert.equal((await db("o_agentTrace").where("eventType", "tool.interrupted")).length, 1);
    release({ novelId: 10, chapterIndex: 1, chapter: "开篇", text: "迟到结果" });
    await assert.rejects(executing);
    assert.equal((await db("o_agentToolReceipt").first()).status, "failed");
  } finally { release?.({ novelId: 10, chapterIndex: 1, chapter: "开篇", text: "迟到结果" }); await db.destroy(); }
});
