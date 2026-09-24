import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import knexFactory from "knex";

import { createCommittedToolContextSourceLoader } from "../src/context/toolSources";
import { TOOL_DEFINITIONS } from "../src/controlledTools";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("only a committed, schema-valid ToolReceipt in this Project Run enters Context", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.schema.createTable("o_agentRun", (table) => { table.text("id").primary(); table.integer("projectId"); });
    await db.schema.createTable("o_agentToolReceipt", (table) => {
      table.text("id").primary(); table.text("runId"); table.text("toolName");
      table.text("toolRevision"); table.text("status"); table.text("outputJson"); table.text("outputHash");
      table.integer("updatedAt");
    });
    await db.schema.createTable("o_agentTrace", (table) => {
      table.text("id").primary(); table.text("runId"); table.integer("sequence");
      table.text("predecessorTraceId"); table.text("toolReceiptId"); table.text("eventType");
      table.integer("createdAt");
    });
    await db("o_agentRun").insert([{ id: "run-7", projectId: 7 }, { id: "run-9", projectId: 9 }]);
    const output = JSON.stringify({ novelId: 2, chapterIndex: 1, chapter: "序章", text: "可读原文" });
    const base = { toolName: "get_novel_text", toolRevision: TOOL_DEFINITIONS.get_novel_text.revision,
      status: "succeeded", outputJson: output, outputHash: hash(output), updatedAt: 10 };
    await db("o_agentToolReceipt").insert([{ id: "valid", runId: "run-7", ...base },
      { id: "foreign", runId: "run-9", ...base },
      { id: "pending", runId: "run-7", ...base, status: "pending" },
      { id: "invalid", runId: "run-7", ...base, outputHash: "0".repeat(64) }]);
    await db("o_agentTrace").insert([{ id: "trace-1", runId: "run-7", sequence: 1,
      predecessorTraceId: null, toolReceiptId: "valid", eventType: "tool.succeeded", createdAt: 10 }]);
    const loader = createCommittedToolContextSourceLoader(async (operation) => operation(db));
    const candidates = await loader.load({ runId: "run-7", projectId: 7,
      receiptIds: ["foreign", "pending", "valid"] });
    assert.deepEqual(candidates.map((entry) => entry.id), ["tool:valid"]);
    assert.ok(candidates[0].content.includes("可读原文"));
    await assert.rejects(loader.load({ runId: "run-7", projectId: 9,
      receiptIds: ["valid"] }), /outside Project scope/);
    await assert.rejects(loader.load({ runId: "run-7", projectId: 7,
      receiptIds: ["invalid"] }), /evidence is invalid/);
    await db("o_agentTrace").where({ id: "trace-1" }).update({ toolReceiptId: "other" });
    await assert.rejects(loader.load({ runId: "run-7", projectId: 7,
      receiptIds: ["valid"] }), /evidence is invalid/);
  } finally { await db.destroy(); }
});
