import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime } from "../src/agentRuntime";
import { prepareScriptSkillRun } from "../src/agents/scriptAgent/harnessPreparation";
import { SCRIPT_PROPOSAL_TOOL_DEFINITIONS, toolDefinitionContractHash } from
  "../src/controlledTools/definitions";
import { createScriptWriteApprovalRuntime } from "../src/controlledTools/scriptWriteApproval";
import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { createProjectSkillGrantRuntime, resolveReadOnlyScriptSkillGrants,
  resolveScriptProposalGrants } from
  "../src/skillRuntime/grants";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from
  "../src/skillRuntime/manifest";
import { authorizeBoundSkillDefinition } from "../src/skillRuntime/permissions";

test("Script proposal needs a frozen Skill request and a revocable Project grant", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert({ id: 7, userId: 1, name: "提案权限测试" });
    let serial = 0;
    const work = async <T>(operation: (database: typeof db) => Promise<T> | T) => operation(db);
    const createId = () => `script-proposal-${++serial}`;
    const skills = createSkillRuntime({ work, now: () => 100, createId });
    const skill = await skills.createDefinition({ name: "script-proposal", description: "只提出待审批候选" });
    const definition = SCRIPT_PROPOSAL_TOOL_DEFINITIONS.propose_script_workspace_write;
    const manifest: SkillManifest = { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
      skillId: skill.id, semanticVersion: "1.0.0", compatibleRoles: ["scriptAgent"],
      intents: ["read-only-guidance"], dependencies: [],
      requestedTools: [definition.name],
      requestedCapabilities: ["propose:script-workspace"], resources: [],
      routing: { priority: 1, keywords: [] }, attribution: "提案权限定向测试" };
    const draft = await skills.saveDraft({ skillId: skill.id,
      semanticVersion: "1.0.0", content: "提出候选但不能自行写入", manifest });
    await skills.publish({ revisionId: draft.id, expectedContentHash: draft.contentHash });
    await skills.activate({ skillId: skill.id, revisionId: draft.id,
      expectedBindingVersion: 0 });
    const runtime = createAgentRuntime({ work, now: () => 100, createId,
      schedule: () => undefined, openTextCall: async () => { throw new Error("no Model"); },
      prepareRun: async () => undefined,
      skillMode: { grants: async () => ({ platformGrants: [], projectGrants: [],
        runGrants: [], roleGrants: [] }) } });
    const run = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "script-harness-guidance-v1",
      clientRequestId: "proposal-run", content: "提出建议", actorUserId: 1 });
    await skills.bindResolvedRun({ runId: run.id, projectId: 7,
      rootSkillIds: [skill.id] });
    const decision = () => db.transaction(async (tx) =>
      authorizeBoundSkillDefinition(tx, { runId: run.id, projectId: 7,
        skillId: skill.id, ...await resolveScriptProposalGrants(tx, {
          runId: run.id, projectId: 7, kind: "workspace" }) }, definition));
    assert.equal((await decision()).decision.allowed, false);
    const grants = createProjectSkillGrantRuntime({ work, now: () => 150 });
    assert.deepEqual(await grants.inspectScriptProposals(7, 1), {
      workspace: { active: false, version: 0 },
      script: { active: false, version: 0 },
    });
    await assert.rejects(grants.inspectScriptProposals(7, 2), /owner/);
    await assert.rejects(grants.setProposeScriptWorkspace({ projectId: 7,
      actorUserId: 2, expectedVersion: 0, active: true }), /owner/);
    await grants.setProposeScriptWorkspace({ projectId: 7, actorUserId: 1,
      expectedVersion: 0, active: true });
    assert.deepEqual((await grants.inspectScriptProposals(7, 1)).workspace,
      { active: true, version: 1 });
    assert.equal((await decision()).decision.allowed, true);
    await db("o_agentRun").where({ id: run.id }).update({ status: "running",
      leaseOwnerId: "worker", leaseEpoch: "epoch", leaseExpiresAt: 500, fence: 1 });
    const lease = { runId: run.id, ownerId: "worker", epoch: "epoch",
      expiresAt: 500, fence: 1 };
    const proposals = createScriptWriteApprovalRuntime({ work, now: () => 200, createId });
    const source = { projectId: 7, parentRunId: run.id, skillId: skill.id,
      lease, operationId: "model-tool-call-1", kind: "workspace" as const,
      payload: { key: "storySkeleton", content: "模型提出的新骨架" } };
    const pending = await proposals.proposeFromAgent(source);
    assert.equal(pending.status, "pending");
    if (pending.status === "pending") {
      const linked = await proposals.inspect(7, pending.approvalRunId, 1);
      assert.equal(linked?.sourceRunId, run.id);
      assert.equal(linked?.sourceOperationId, source.operationId);
    }
    assert.deepEqual(await proposals.proposeFromAgent(source), pending);
    assert.equal((await db("o_agentRun").where({ scope: "approved-script-write-v1" })).length, 1);
    assert.equal((await db("o_agentWorkData").where({ projectId: 7 })).length, 0,
      "model proposal is not the Project write effect");
    assert.ok((await db("o_agentTrace").where({ runId: run.id }))
      .some((trace) => trace.eventType === "tool.proposal.created"));
    await assert.rejects(proposals.proposeFromAgent({ ...source,
      operationId: "invalid-lease-call", lease: { ...lease, fence: 2 } }), /lease/i);
    assert.deepEqual(await proposals.proposeFromAgent({ ...source,
      operationId: "undeclared-script-call", kind: "script",
      payload: { effect: "create", name: "第一集", content: "草稿" } }),
    { status: "denied" }, "a Workspace-only Skill cannot propose Script content");
    await grants.setProposeScriptWorkspace({ projectId: 7, actorUserId: 1,
      expectedVersion: 1, active: false });
    assert.equal((await decision()).decision.allowed, false);
    assert.deepEqual(await proposals.proposeFromAgent({ ...source,
      operationId: "revoked-call" }), { status: "denied" });
    await db("o_project").where({ id: 7 }).update({ userId: 2 });
    await assert.rejects(proposals.proposeFromAgent({ ...source,
      operationId: "owner-changed-call" }), /scope/);
    await db("o_project").where({ id: 7 }).update({ userId: 1 });
    await grants.setProposeScriptWorkspace({ projectId: 7, actorUserId: 1,
      expectedVersion: 2, active: true });
    const queue: Array<() => Promise<void>> = [];
    let modelResult: unknown;
    const modelRuntime = createAgentRuntime({ work, now: () => 250, createId,
      schedule: (operation) => queue.push(operation),
      prepareRun: (tx, input) => prepareScriptSkillRun(tx, input, createId),
      skillMode: { grants: resolveReadOnlyScriptSkillGrants },
      proposeScriptWrite: (input) => proposals.proposeFromAgent(input),
      openTextCall: async () => ({ target: { vendorId: "fake",
        modelId: "proposal-model", contextWindowTokens: 50_000,
        maxOutputTokens: 256 },
      invokeText: async (callInput) => {
        assert.ok(callInput.messages?.some((message) => message.role === "system"
          && message.content.includes("只有 Owner 查看全文并批准后才可能生效")));
        const propose = callInput.tools!.propose_script_workspace_write;
        modelResult = await propose.execute!({ key: "storySkeleton",
          content: "模型建议的完整正文" },
        { toolCallId: "model-proposal-call", messages: [] });
        return { text: "已提交待 Owner 审批的候选，尚未写入" } as any;
      } }) });
    const modelRun = await modelRuntime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: "scriptAgent", scope: "script-harness-guidance-v1",
      clientRequestId: "model-proposal-run", content: "请提出故事骨架候选",
      actorUserId: 1 });
    while (queue.length) await queue.shift()!();
    assert.equal((await modelRuntime.inspect({ runId: modelRun.id,
      projectId: 7, actorUserId: 1 }))?.status, "succeeded");
    assert.equal((modelResult as { status: string }).status, "pending");
    const childRunId = (modelResult as { approvalRunId: string }).approvalRunId;
    assert.equal((await proposals.inspect(7, childRunId, 1))?.status, "pending");
    assert.equal((await db("o_agentWorkData").where({ projectId: 7 })).length, 0);
    const permission = await db("o_agentSkillPermissionDecision")
      .where({ runId: modelRun.id, operationId: "model-proposal-call" }).first();
    assert.equal(JSON.parse(permission.decisionJson).allowed, true);
    const approval = await proposals.inspect(7, childRunId, 1);
    assert(approval);
    assert.equal(approval.sourceRunId, modelRun.id);
    assert.equal(approval.sourceOperationId, "model-proposal-call");
    const reviewed = await proposals.review(7, childRunId, approval.id, 1);
    assert.equal(reviewed?.payload.content, "模型建议的完整正文");
    assert.equal((await proposals.decide({ projectId: 7, actorUserId: 1,
      runId: childRunId, approvalId: approval.id,
      clientCommandId: "owner-approve-model-proposal", expectedVersion: 1,
      decision: "approve" }))?.status, "approved");
    assert.equal(JSON.parse((await db("o_agentWorkData")
      .where({ projectId: 7 }).first()).data).storySkeleton,
    "模型建议的完整正文");
    assert.notEqual(toolDefinitionContractHash(definition),
      toolDefinitionContractHash(SCRIPT_PROPOSAL_TOOL_DEFINITIONS.propose_script_content_write));
    assert.equal((await db("o_agentToolReceipt").where({ runId: run.id })).length, 0,
      "the parent model Run never owns the child approval receipt");
  } finally { await db.destroy(); }
});
