import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime } from "../src/agentRuntime";
import { deleteProjectAgentEvidence } from "../src/agentRuntime/retention";
import { createContextBuilder } from "../src/context";
import initDB from "../src/lib/initDB";
import { createProjectMemoryContextSourceLoader } from "../src/memory/contextSources";
import { createProjectMemoryStore } from "../src/memory/projectMemory";

test("Project Memory captures only a locatable excerpt of a committed same-Project Step Output", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert([{ id: 7, userId: 1, name: "本项目" },
      { id: 9, userId: 1, name: "另一项目" }]);
    await db("memories").insert({ id: "legacy-1", isolationKey: "7:scriptAgent",
      type: "summary", content: "旧隔离键不构成来源证明", createTime: 10 });
    const queue: Array<() => Promise<void>> = [];
    let serial = 0;
    const runtime = createAgentRuntime({ work: async (operation) => operation(db),
      now: () => 100 + serial, createId: () => `memory-agent-${++serial}`,
      schedule: (work) => queue.push(work),
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "text-v1" },
        invokeText: async () => ({ text: "甲😀乙丙" }) } as any) });
    const run = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "memory-capture", content: "核对来源" });
    const store = createProjectMemoryStore({ work: async (operation) => operation(db),
      now: () => 200, createId: () => "memory-1" });
    const source = { projectId: 7, runId: run.id, stepId: run.steps[0].id,
      outputId: "missing", startCodePoint: 1, lengthCodePoints: 2 };
    await assert.rejects(store.captureOutputExcerpt(source), /committed, intact source Output/);
    while (queue.length) await queue.shift()!();
    const completed = await runtime.inspect({ runId: run.id, projectId: 7 });
    const input = { ...source, outputId: completed!.outputs[0].id };
    const memory = await store.captureOutputExcerpt(input);
    assert.equal(memory.content, "😀乙");
    assert.equal(memory.confidence, "source-verbatim");
    assert.equal(memory.sourceOutputHash, completed!.outputs[0].contentHash);
    assert.deepEqual(await store.captureOutputExcerpt(input), memory);
    assert.equal((await db("o_agentProjectMemory")).length, 1);
    assert.equal((await db("memories")).length, 1, "legacy Memory is preserved, not silently promoted");
    await assert.rejects(store.captureOutputExcerpt({ ...input, projectId: 9 }), /Project scope/);
    await assert.rejects(store.captureOutputExcerpt({ ...input, startCodePoint: 3, lengthCodePoints: 2 }),
      /outside the committed Output/);
    const current = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "memory-consumer", content: "参考之前的连续性记录" });
    const builder = createContextBuilder({ work: async (operation) => operation(db),
      now: () => 300, createId: () => "memory-bundle-1" });
    const bundle = await builder.build({ runId: current.id, stepId: current.steps[0].id,
      attemptId: current.attempts[0].id, projectId: 7, role: "scriptAgent",
      systemContract: "仅按获准事实回答", stepIntent: "参考之前的连续性记录",
      toolAndPermissionContract: "只读", modelRevision: "fake-text-v1",
      budget: { contextWindowTokens: 20_000, policyMaxInputTokens: 10_000,
        outputReserveTokens: 2_000, toolProtocolReserveTokens: 100, risk: "high" },
      novelIds: [], requiredNovelIds: [], memoryIds: [memory.id],
      requiredMemoryIds: [memory.id], expectedRevisions: { [`memory:${memory.id}`]: memory.revision } });
    assert.ok(bundle.messages.some((message) => message.content.includes("😀乙") && message.role === "user"));
    const manifest = JSON.parse((await db("o_agentContextBundle").where({ id: bundle.id }).first()).manifestJson);
    assert.ok(manifest.sources.some((entry: { id: string }) => entry.id === `memory:${memory.id}`));
    assert.equal(JSON.stringify(manifest).includes("😀乙"), false);
    await db("o_agentRunOutput").where({ id: input.outputId }).update({ contentHash: "0".repeat(64) });
    await assert.rejects(store.captureOutputExcerpt(input), /committed, intact source Output/);
    await assert.rejects(createProjectMemoryContextSourceLoader(async (operation) => operation(db)).load({
      runId: current.id, projectId: 7, memoryIds: [memory.id], risk: "high",
    }), /no longer authorized or current/);
    await db("o_agentRunOutput").where({ id: input.outputId })
      .update({ contentHash: completed!.outputs[0].contentHash });
    await db("o_agentRunAttempt").where({ id: completed!.attempts[0].id }).update({ status: "failed" });
    await assert.rejects(createProjectMemoryContextSourceLoader(async (operation) => operation(db)).load({
      runId: current.id, projectId: 7, memoryIds: [memory.id], risk: "high",
    }), /no longer authorized or current/,
    "a failed source Attempt cannot remain active Memory evidence");
    const revoked = await store.revoke({ projectId: 7, id: memory.id,
      expectedRevision: memory.revision, commandId: "revoke-1" });
    assert.equal(revoked.status, "revoked");
    assert.deepEqual(await store.revoke({ projectId: 7, id: memory.id,
      expectedRevision: memory.revision, commandId: "revoke-1" }), revoked);
    await assert.rejects(store.revoke({ projectId: 7, id: memory.id,
      expectedRevision: memory.revision, commandId: "revoke-2" }), /conflicts with lifecycle/);
    await assert.rejects(db("o_agentProjectMemory").where({ id: memory.id })
      .update({ content: "伪造的新记忆" }), /immutable/);
    await assert.rejects(db("o_agentProjectMemory").where({ id: memory.id }).delete(), /durable evidence/);
    assert.deepEqual(await createProjectMemoryContextSourceLoader(async (operation) => operation(db)).load({
      runId: current.id, projectId: 7, memoryIds: [memory.id], risk: "high",
    }), [], "revoked Memory cannot enter Context");
    await db.transaction(async (tx) => {
      await tx("o_project").where({ id: 7 }).delete();
      await deleteProjectAgentEvidence(tx, 7);
    });
    assert.equal((await db("o_agentProjectMemory").where({ projectId: 7 })).length, 0,
      "Project deletion removes derived Memory before its source evidence");
    assert.equal((await db("o_agentRun").where({ projectId: 7 })).length, 0);
  } finally { await db.destroy(); }
});
