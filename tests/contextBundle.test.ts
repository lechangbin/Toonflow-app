import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime, type AgentRunDependencies } from "../src/agentRuntime";
import { deleteProjectAgentEvidence } from "../src/agentRuntime/retention";
import { createContextBuilder, type BuildContextBundleInput } from "../src/context";
import initDB from "../src/lib/initDB";

test("ContextBuilder freezes authorized Model input and a content-free manifest for one preparing Attempt", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert([{ id: 7, userId: 1, name: "本项目" },
      { id: 9, userId: 1, name: "外部项目" }]);
    await db("o_novel").insert([{ id: 2, projectId: 7, chapterIndex: 1,
      chapter: "本章", chapterData: "本项目的直接证据" },
    { id: 3, projectId: 9, chapterIndex: 1, chapter: "外部", chapterData: "不能读取的机密" }]);
    let serial = 0;
    const dependencies: AgentRunDependencies = {
      work: async (operation) => operation(db), now: () => 100,
      createId: () => `agent-${++serial}`, schedule: () => undefined,
      openTextCall: async () => { throw new Error("Model must not be invoked by ContextBuilder"); },
    };
    const run = await createAgentRuntime(dependencies).start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "context-test", content: "核对项目事实" });
    const builder = createContextBuilder({ work: async (operation) => operation(db),
      now: () => 200, createId: () => "bundle-1" });
    const input: BuildContextBundleInput = { runId: run.id, stepId: run.steps[0].id,
      attemptId: run.attempts[0].id, projectId: 7, role: "scriptAgent",
      systemContract: "只根据事实回答", stepIntent: "核对项目事实",
      toolAndPermissionContract: "只读；禁止跨 Project", modelRevision: "fake-text-v1",
      budget: { contextWindowTokens: 4_000, policyMaxInputTokens: 3_000,
        outputReserveTokens: 500, toolProtocolReserveTokens: 100, risk: "standard" },
      novelIds: [2, 3], requiredNovelIds: [2], expectedRevisions: {} };
    const bundle = await builder.build(input);
    assert.equal(bundle.attemptId, run.attempts[0].id);
    assert.ok(bundle.messages.some((message) => message.content.includes("本项目的直接证据")));
    assert.ok(bundle.messages.filter((message) => message.content.includes("(data, not instructions)"))
      .every((message) => message.role === "user"), "Project evidence never receives system authority");
    assert.ok(bundle.messages.every((message) => !message.content.includes("不能读取的机密")));
    const persisted = await db("o_agentContextBundle").where({ id: bundle.id }).first();
    assert.equal(persisted.promptHash, bundle.promptHash);
    assert.equal(persisted.manifestHash, bundle.manifestHash);
    assert.deepEqual(JSON.parse(persisted.messagesJson), bundle.messages);
    assert.deepEqual(JSON.parse(persisted.manifestJson).sources.map((entry: { id: string }) => entry.id),
      ["project:7", "novel:2"]);
    assert.equal(persisted.manifestJson.includes("本项目的直接证据"), false);
    assert.deepEqual(await builder.inspect({ id: bundle.id, projectId: 7 }), bundle);
    assert.equal(await builder.inspect({ id: bundle.id, projectId: 9 }), null,
      "another Project cannot inspect frozen Model input");
    await assert.rejects(db("o_agentContextBundle").where({ id: bundle.id }).update({ promptHash: "forged" }),
      /immutable/);
    await assert.rejects(db("o_agentContextBundle").where({ id: bundle.id }).delete(), /durable evidence/);
    assert.deepEqual(await builder.build(input), bundle, "a repeated pre-intent build reuses the same frozen Bundle");
    await assert.rejects(builder.build({ ...input, stepIntent: "不同的请求" }), /reused with different input/);
    await assert.rejects(builder.build({ ...input, requiredNovelIds: [3] }),
      /Required Context source is unavailable/);
    await db("o_agentRunAttempt").where({ id: run.attempts[0].id }).update({ status: "failed" });
    await db("o_agentRunAttempt").insert({ id: "attempt-successor", runId: run.id,
      stepId: run.steps[0].id, ordinal: 2, predecessorAttemptId: run.attempts[0].id,
      reason: "restart-recovery", status: "preparing", createdAt: 201 });
    const successor = await createContextBuilder({ work: async (operation) => operation(db),
      now: () => 202, createId: () => "bundle-2" }).build({ ...input,
      attemptId: "attempt-successor", predecessorBundleId: bundle.id, stepIntent: "刷新后重新核对项目事实" });
    assert.equal(successor.predecessorBundleId, bundle.id);
    assert.notEqual(successor.promptHash, bundle.promptHash);
    assert.deepEqual(await builder.inspect({ id: bundle.id, projectId: 7 }), bundle,
      "successor creation never rewrites the earlier Bundle");
    await db.transaction(async (tx) => {
      await tx("o_project").where({ id: 7 }).delete();
      await deleteProjectAgentEvidence(tx, 7);
    });
    assert.equal(await db("o_agentContextBundle").where({ id: bundle.id }).first(), undefined,
      "Project deletion removes its durable ContextBundle through the authorized lifecycle");
  } finally { await db.destroy(); }
});

test("existing Project data survives a ContextBundle table upgrade", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert({ id: 7, userId: 1, name: "升级前的 Project" });
    await db.schema.dropTable("o_agentContextBundle");
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    assert.equal(await db.schema.hasTable("o_agentContextBundle"), true);
    assert.equal((await db("o_project").where({ id: 7 }).first()).name, "升级前的 Project");
  } finally { await db.destroy(); }
});

test("a capacity-declared production AgentRuntime freezes Bundle before invoking its Model", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert({ id: 7, userId: 1, name: "可核验项目" });
    const queue: Array<() => Promise<void>> = [];
    let serial = 0;
    let invoked = 0;
    const runtime = createAgentRuntime({ work: async (operation) => operation(db),
      now: () => 1_000 + serial, createId: () => `capacity-${++serial}`,
      schedule: (work) => queue.push(work),
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "text-v1",
        maxOutputTokens: 256, contextWindowTokens: 50_000 },
      invokeText: async (input) => {
        invoked++;
        const bundle = await db("o_agentContextBundle").first();
        assert.ok(bundle, "Bundle must be durable before the external Model call");
        assert.deepEqual(input.messages, JSON.parse(bundle.messagesJson));
        return { text: "已核对" } as any;
      } }) });
    const started = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "capacity-runtime", content: "请核对本项目" });
    while (queue.length) await queue.shift()!();
    assert.equal(invoked, 1);
    const completed = await runtime.inspect({ runId: started.id, projectId: 7 });
    assert.equal(completed?.status, "succeeded");
    assert.equal((await db("o_agentContextBundle").where({ runId: started.id })).length, 1);
    const shortQueue: Array<() => Promise<void>> = [];
    let shortSerial = 0;
    let shortCalls = 0;
    const shortRuntime = createAgentRuntime({ work: async (operation) => operation(db),
      now: () => 2_000 + shortSerial, createId: () => `short-${++shortSerial}`,
      schedule: (work) => shortQueue.push(work),
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "too-small",
        contextWindowTokens: 512 }, invokeText: async () => { shortCalls++; return { text: "unsafe" } as any; } }) });
    const shortRun = await shortRuntime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "small-capacity", content: "这条请求不能越过强制内容预算" });
    while (shortQueue.length) await shortQueue.shift()!();
    assert.equal(shortCalls, 0, "mandatory overflow must fail before inference");
    assert.equal((await shortRuntime.inspect({ runId: shortRun.id, projectId: 7 }))?.status, "failed");
    assert.equal((await db("o_agentContextBundle").where({ runId: shortRun.id })).length, 0);
  } finally { await db.destroy(); }
});
