import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import knexFactory from "knex";

import { createCommittedToolContextSourceLoader } from "../src/context/toolSources";
import { HARNESS_TOOL_DEFINITIONS, TOOL_DEFINITIONS } from "../src/controlledTools";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("only a committed, schema-valid ToolReceipt in this Project Run enters Context", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.schema.createTable("o_agentRun", (table) => { table.text("id").primary(); table.integer("projectId"); });
    await db.schema.createTable("o_agentRunStep", (table) => {
      table.text("id").primary(); table.text("runId"); table.integer("ordinal");
    });
    await db.schema.createTable("o_agentRunAttempt", (table) => {
      table.text("id").primary(); table.text("runId"); table.text("stepId");
    });
    await db.schema.createTable("o_agentToolReceipt", (table) => {
      table.text("id").primary(); table.text("runId"); table.text("toolName");
      table.text("toolRevision"); table.text("status"); table.text("outputJson"); table.text("outputHash");
      table.integer("updatedAt");
    });
    await db.schema.createTable("o_agentTrace", (table) => {
      table.text("id").primary(); table.text("runId"); table.text("stepId"); table.text("attemptId"); table.integer("sequence");
      table.text("predecessorTraceId"); table.text("toolReceiptId"); table.text("eventType");
      table.integer("createdAt");
    });
    await db("o_agentRun").insert([{ id: "run-7", projectId: 7 }, { id: "run-9", projectId: 9 }]);
    await db("o_agentRunStep").insert([{ id: "step-before", runId: "run-7", ordinal: 1 },
      { id: "step-current", runId: "run-7", ordinal: 2 },
      { id: "step-after", runId: "run-7", ordinal: 3 }]);
    await db("o_agentRunAttempt").insert([{ id: "attempt-before", runId: "run-7", stepId: "step-before" },
      { id: "attempt-current", runId: "run-7", stepId: "step-current" },
      { id: "attempt-foreign", runId: "run-9", stepId: "step-before" }]);
    const output = JSON.stringify({ novelId: 2, chapterIndex: 1, chapter: "序章", text: "可读原文".repeat(600) });
    const base = { toolName: "get_novel_text", toolRevision: TOOL_DEFINITIONS.get_novel_text.revision,
      status: "succeeded", outputJson: output, outputHash: hash(output), updatedAt: 10 };
    await db("o_agentToolReceipt").insert([{ id: "valid", runId: "run-7", ...base },
      { id: "foreign", runId: "run-9", ...base },
      { id: "pending", runId: "run-7", ...base, status: "pending" },
      { id: "invalid", runId: "run-7", ...base, outputHash: "0".repeat(64) }]);
    await db("o_agentTrace").insert([{ id: "trace-1", runId: "run-7", stepId: "step-before", attemptId: "attempt-before", sequence: 1,
      predecessorTraceId: null, toolReceiptId: "valid", eventType: "tool.succeeded", createdAt: 10 }]);
    const loader = createCommittedToolContextSourceLoader(async (operation) => operation(db));
    const candidates = await loader.load({ runId: "run-7", stepId: "step-current", projectId: 7,
      receiptIds: ["foreign", "pending", "valid"] });
    assert.deepEqual(candidates.map((entry) => entry.id), ["tool:valid"]);
    assert.ok(candidates[0].content.includes("可读原文"));
    assert.ok(candidates[0].compact?.content.includes("full output omitted"));
    assert.equal(candidates[0].compact?.transform.sourceContentHash, candidates[0].contentHash);
    assert.equal(candidates[0].compact?.transform.strategy, "novel-text-prefix-128");
    assert.equal(candidates[0].compact?.content.includes("可读原文".repeat(600)), false);
    const workspaceOutput = JSON.stringify({ key: "storySkeleton", content: "已读草稿".repeat(600) });
    await db("o_agentToolReceipt").insert({ id: "workspace", runId: "run-7",
      toolName: "get_script_workspace", toolRevision: HARNESS_TOOL_DEFINITIONS.get_script_workspace.revision,
      status: "succeeded", outputJson: workspaceOutput, outputHash: hash(workspaceOutput), updatedAt: 10 });
    await db("o_agentTrace").insert({ id: "trace-2", runId: "run-7", stepId: "step-before",
      attemptId: "attempt-before", sequence: 2, predecessorTraceId: "trace-1",
      toolReceiptId: "workspace", eventType: "tool.succeeded", createdAt: 12 });
    const workspace = await loader.load({ runId: "run-7", stepId: "step-current", projectId: 7,
      receiptIds: ["workspace"] });
    assert.equal(workspace[0].compact, undefined,
      "new Script Tools must not inherit an unrelated Novel projection strategy");
    assert.ok(workspace[0].content.includes("已读草稿"));
    await assert.rejects(loader.load({ runId: "run-7", stepId: "step-current", projectId: 9,
      receiptIds: ["valid"] }), /outside Project scope/);
    await assert.rejects(loader.load({ runId: "run-7", stepId: "step-after", projectId: 7,
      receiptIds: ["invalid"] }), /evidence is invalid/);
    await db("o_agentTrace").where({ id: "trace-1" }).update({ attemptId: "attempt-current" });
    await assert.rejects(loader.load({ runId: "run-7", stepId: "step-current", projectId: 7,
      receiptIds: ["valid"] }), /evidence is invalid/,
    "a successful Trace with an Attempt from another Step is not a valid source");
    await db("o_agentTrace").where({ id: "trace-1" }).update({ attemptId: "attempt-foreign" });
    await assert.rejects(loader.load({ runId: "run-7", stepId: "step-current", projectId: 7,
      receiptIds: ["valid"] }), /evidence is invalid/,
    "an Attempt from another Run cannot lend provenance to this Tool result");
    await db("o_agentTrace").where({ id: "trace-1" }).update({ attemptId: "attempt-before" });
    await db("o_agentTrace").where({ id: "trace-1" }).update({ stepId: "step-current" });
    await assert.rejects(loader.load({ runId: "run-7", stepId: "step-current", projectId: 7,
      receiptIds: ["valid"] }), /evidence is invalid/,
    "a Tool result from the current Step cannot be projected backward into its Model input");
    await db("o_agentTrace").where({ id: "trace-1" }).update({ stepId: "step-after" });
    await assert.rejects(loader.load({ runId: "run-7", stepId: "step-current", projectId: 7,
      receiptIds: ["valid"] }), /evidence is invalid/,
    "a future Step cannot become past Model evidence");
    await db("o_agentTrace").where({ id: "trace-1" }).update({ stepId: "step-before", toolReceiptId: "other" });
    await assert.rejects(loader.load({ runId: "run-7", stepId: "step-current", projectId: 7,
      receiptIds: ["valid"] }), /evidence is invalid/);
  } finally { await db.destroy(); }
});
