import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import knexFactory from "knex";

import { createRecentInteractionSourceLoader } from "../src/context/recentInteractionSources";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("recent interaction uses only earlier completed Runs in the exact Project, Script and Role scope", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.schema.createTable("o_agentRun", (table) => {
      table.text("id").primary(); table.integer("projectId"); table.integer("scriptId");
      table.text("role"); table.text("scope"); table.text("status"); table.text("input");
      table.integer("createdAt"); table.integer("completedAt");
    });
    await db.schema.createTable("o_agentRunOutput", (table) => {
      table.text("runId"); table.text("kind"); table.text("content");
      table.text("contentHash"); table.text("schemaVersion"); table.integer("createdAt");
    });
    const base = { projectId: 7, scriptId: 2, role: "scriptAgent", scope: "read-only",
      status: "succeeded", input: JSON.stringify({ content: "先前问题" }), createdAt: 10, completedAt: 20 };
    await db("o_agentRun").insert([
      { id: "prior", ...base },
      { id: "current", ...base, status: "queued", createdAt: 50, completedAt: null },
      { id: "foreign", ...base, projectId: 9 },
      { id: "other-script", ...base, scriptId: 3 },
      { id: "other-role", ...base, role: "productionAgent" },
      { id: "future", ...base, completedAt: 60 },
      { id: "chronology-invalid", ...base, createdAt: 60, completedAt: 20 },
      { id: "unfinished", ...base, status: "running" },
    ]);
    const reply = "先前回答";
    await db("o_agentRunOutput").insert({ runId: "prior", kind: "assistant-text", content: reply,
      contentHash: hash(JSON.stringify(reply)), schemaVersion: "toonflow.agent-run-output.v1", createdAt: 20 });
    const loader = createRecentInteractionSourceLoader(async (operation) => operation(db));
    const candidates = await loader.load({ runId: "current", projectId: 7 });
    assert.deepEqual(candidates.map((candidate) => candidate.id), ["interaction:prior"]);
    assert.equal(candidates[0].category, "recentInteraction");
    assert.equal(candidates[0].authorityRank, 3);
    assert.match(candidates[0].content, /先前问题/);
    assert.match(candidates[0].content, /先前回答/);
    assert.equal(candidates[0].content.includes("system"), false);
    await assert.rejects(loader.load({ runId: "current", projectId: 9 }), /outside Project scope/);
    await db("o_agentRunOutput").where({ runId: "prior" }).update({ contentHash: "0".repeat(64) });
    await assert.rejects(loader.load({ runId: "current", projectId: 7 }), /evidence is corrupt/);
  } finally { await db.destroy(); }
});
