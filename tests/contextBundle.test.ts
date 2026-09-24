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
    await assert.rejects(builder.build(input), /UNIQUE constraint failed/);
    await assert.rejects(builder.build({ ...input, requiredNovelIds: [3] }),
      /Required Context source is unavailable/);
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
