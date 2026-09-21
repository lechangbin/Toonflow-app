import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import {
  AgentRunConflictError,
  AgentRunContentRejectedError,
  AgentRunEvidenceCorruptError,
  AgentRunStateConflictError,
  assertAgentRunStepTransition,
  assertAgentRunTransition,
  createAgentRuntime,
  projectAgentRunToChatMessage,
  type AgentRunDependencies,
} from "../src/agentRuntime";

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
    table.integer("version").notNullable();
    table.integer("createdAt").notNullable();
    table.integer("updatedAt").notNullable();
    table.integer("startedAt");
    table.integer("completedAt");
    table.unique(["projectId", "role", "scope", "clientRequestId"]);
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
  await db.schema.createTable("o_agentTrace", (table) => {
    table.text("id").primary();
    table.text("runId").notNullable();
    table.text("stepId");
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
  await db("o_novel").insert([{ id: 1, projectId: 7, chapterIndex: 1 }, { id: 2, projectId: 7, chapterIndex: 2 }]);
  return db;
}

function makeHarness(db: Knex, model: () => Promise<string> = async () => "只读建议", idPrefix = "id") {
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
    await harness.flush();
    const completed = await harness.runtime.inspect({ runId: first.id, projectId: 7 });
    assert.equal(completed?.status, "succeeded");
    assert.equal(completed?.outputs[0]?.content, "只读建议");
    assert.equal(harness.calls(), 1);
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

test("a failed Model Step stores only a Trace-safe diagnostic", async () => {
  const db = await createDatabase();
  try {
    const secret = "sk_forbidden_provider_message";
    const harness = makeHarness(db, async () => { throw new Error(secret); });
    const started = await harness.runtime.start(startInput);
    await harness.flush();
    const failed = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    assert.equal(failed?.status, "failed");
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
    assert.equal(failed?.status, "failed");
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
    await db("o_agentTrace").where({ runId: started.id, eventType: "run.failed" }).update({
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

test("terminal commit rolls back output, Step, Run, and Trace together", async () => {
  const db = await createDatabase();
  try {
    const harness = makeHarness(db);
    const started = await harness.runtime.start(startInput);
    await db.raw(`CREATE TRIGGER reject_success_trace BEFORE INSERT ON o_agentTrace
      WHEN NEW.eventType = 'run.succeeded' BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    await harness.flush();
    const snapshot = await harness.runtime.inspect({ runId: started.id, projectId: 7 });
    assert.equal(snapshot?.status, "failed");
    assert.equal(snapshot?.steps[0]?.status, "failed");
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
