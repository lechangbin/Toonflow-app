import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { readProductionWorkspaceText } from "../src/agents/productionAgent/harnessWorkspaceRead";
import { HARNESS_TOOL_DEFINITIONS, toolDefinitionContractHash } from
  "../src/controlledTools/definitions";

test("production workspace read uses a distinct immutable, read-only contract", () => {
  const definition = HARNESS_TOOL_DEFINITIONS.get_production_workspace_text;
  assert.equal(definition.revision, "toonflow.tool.get-production-workspace-text.v1");
  assert.deepEqual(definition.policy.roles, ["productionAgent"]);
  assert.deepEqual(definition.policy.scopes, ["production-harness-v1"]);
  assert.deepEqual(definition.policy.capabilities, ["read:production-workspace"]);
  assert.equal(definition.policy.risk.mutation, "none");
  assert.match(toolDefinitionContractHash(definition), /^[a-f0-9]{64}$/);
  assert.equal(definition.inputSchema.safeParse({ scriptId: 1,
    key: "assets" }).success, false, "asset generation is not a read shortcut");
});

test("production workspace text is scoped by Project and Script and rejects ambiguity", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" },
    useNullAsDefault: true });
  try {
    await db.schema.createTable("o_script", (table) => {
      table.integer("id").primary(); table.integer("projectId");
    });
    await db.schema.createTable("o_agentWorkData", (table) => {
      table.integer("projectId"); table.integer("episodesId");
      table.text("key"); table.text("data");
    });
    await db("o_script").insert([{ id: 11, projectId: 1 }, { id: 22, projectId: 2 }]);
    await db("o_agentWorkData").insert([
      { projectId: 1, episodesId: 11, key: "productionAgent",
        data: JSON.stringify({ scriptPlan: "本项目拍摄计划", storyboardTable: "本项目分镜表" }) },
      { projectId: 2, episodesId: 22, key: "productionAgent",
        data: JSON.stringify({ scriptPlan: "其他项目秘密" }) },
    ]);
    const input = { projectId: 1, scriptId: 11,
      key: "scriptPlan" as const };
    assert.equal((await readProductionWorkspaceText(db, input)).content, "本项目拍摄计划");
    await assert.rejects(readProductionWorkspaceText(db, { ...input, scriptId: 22 }),
      /outside Run Project/);
    await db("o_agentWorkData").insert({ projectId: 1, episodesId: 11,
      key: "productionAgent", data: "{}" });
    await assert.rejects(readProductionWorkspaceText(db, input), /duplicate rows/);
    await db("o_agentWorkData").where({ projectId: 1, episodesId: 11,
      key: "productionAgent" }).delete();
    assert.equal((await readProductionWorkspaceText(db, input)).content, "",
      "missing workspace is an empty draft, not another Project's data");
    await db("o_agentWorkData").insert({ projectId: 1, episodesId: 11,
      key: "productionAgent", data: "not-json" });
    await assert.rejects(readProductionWorkspaceText(db, input), /invalid JSON/);
    await db("o_agentWorkData").where({ projectId: 1, episodesId: 11,
      key: "productionAgent" }).update({ data: JSON.stringify({
        scriptPlan: "x".repeat(16_001) }) });
    await assert.rejects(readProductionWorkspaceText(db, input));
  } finally { await db.destroy(); }
});
