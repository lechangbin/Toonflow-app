import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime } from "../src/agentRuntime";
import { prepareScriptSkillRun } from "../src/agents/scriptAgent/harnessPreparation";
import { createContextBuilder } from "../src/context";
import { createBoundSkillContextSourceLoader } from "../src/context/skillSources";
import { HARNESS_TOOL_DEFINITIONS } from "../src/controlledTools";
import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from "../src/skillRuntime/manifest";
import { createProjectSkillGrantRuntime, resolveReadOnlyScriptSkillGrants } from "../src/skillRuntime/grants";

test("opt-in Script preparation freezes one routed Skill before Model scheduling and rejects ambiguity", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert({ id: 7, userId: 1, name: "剧本迁移项目" });
    await db("o_novel").insert({ id: 10, projectId: 7,
      chapterIndex: 1, chapter: "开篇", chapterData: "本项目正文" });
    let serial = 0;
    const work = async <T>(operation: (database: typeof db) => Promise<T> | T) => operation(db);
    const createId = () => `script-prep-${++serial}`;
    const skills = createSkillRuntime({ work, now: () => 100, createId });
    const publish = async (name: string, requestedTools: string[] = []) => {
      const definition = await skills.createDefinition({ name, description: name });
      const manifest: SkillManifest = { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
        skillId: definition.id, semanticVersion: "1.0.0", compatibleRoles: ["scriptAgent"],
        intents: ["read-only-guidance"], dependencies: [], requestedTools,
        requestedCapabilities: requestedTools.includes("get_script_workspace")
          ? ["read:script-workspace"] : requestedTools.includes("get_script_content")
            ? ["read:script"] : requestedTools.length ? ["read:novel"] : [],
        resources: [], routing: { priority: 10, keywords: [] },
        attribution: "Script 迁移定向测试" };
      const draft = await skills.saveDraft({ skillId: definition.id,
        semanticVersion: "1.0.0", content: `只读指导 ${name}`, manifest });
      await skills.publish({ revisionId: draft.id, expectedContentHash: draft.contentHash });
      await skills.activate({ skillId: definition.id, revisionId: draft.id,
        expectedBindingVersion: 0 });
      return { skillId: definition.id, revisionId: draft.id };
    };
    const first = await publish("script-guidance-1");
    let scheduled = 0;
    const runtime = createAgentRuntime({ work, now: () => 200,
      createId, schedule: () => { scheduled++; },
      openTextCall: async () => { throw new Error("not executing Model"); },
      prepareRun: (tx, input) => prepareScriptSkillRun(tx, input, createId) });
    const input = { schemaVersion: "toonflow.agent-run.start.v1" as const,
      projectId: 7, role: "scriptAgent" as const,
      scope: "read-only-project-guidance-v1" as const,
      clientRequestId: "prepared-script-run", content: "分析章节", actorUserId: 1 };
    const run = await runtime.start(input);
    assert.equal(scheduled, 1);
    assert.equal((await db("o_agentRunSkillBinding").where({ runId: run.id }).first())?.revisionId,
      first.revisionId);
    assert.equal((await db("o_agentSkillRouteDecision").where({ runId: run.id }).first())?.runId,
      run.id);
    assert.equal((await db("o_agentRunSkillResolution").where({ runId: run.id }).first())?.runId,
      run.id);
    const frozenSources = await createBoundSkillContextSourceLoader(work)
      .load({ runId: run.id, projectId: 7, role: "scriptAgent" });
    assert.deepEqual(frozenSources.map((source) => source.revisionId), [first.revisionId]);
    const bundle = await createContextBuilder({ work, now: () => 250, createId })
      .build({ runId: run.id, stepId: run.steps[0].id,
        attemptId: run.attempts[0].id, projectId: 7, role: "scriptAgent",
        systemContract: "只根据授权事实回答", stepIntent: input.content,
        toolAndPermissionContract: "只读", modelRevision: "fake-text-v1",
        budget: { contextWindowTokens: 10_000, policyMaxInputTokens: 8_000,
          outputReserveTokens: 500, toolProtocolReserveTokens: 100, risk: "standard" },
        novelIds: [], requiredNovelIds: [], expectedRevisions: {}, includeBoundSkills: true });
    assert.ok(bundle.messages.some((message) => message.role === "system"
      && message.content.includes("只读指导 script-guidance-1")));
    const persistedBundle = await db("o_agentContextBundle").where({ id: bundle.id }).first();
    const manifest = JSON.parse(persistedBundle.manifestJson);
    assert.deepEqual(manifest.skillRevisions.map((entry: { revisionId: string }) => entry.revisionId),
      [first.revisionId]);
    assert.equal(persistedBundle.manifestJson.includes("只读指导"), false);
    assert.equal((await runtime.start(input)).id, run.id);
    assert.equal(scheduled, 1, "idempotent start does not reprepare or schedule");
    const queue: Array<() => Promise<void>> = [];
    let modelCalls = 0;
    const guardedRuntime = createAgentRuntime({ work, now: () => 300,
      createId, schedule: (workItem) => queue.push(workItem),
      prepareRun: (tx, prepared) => prepareScriptSkillRun(tx, prepared, createId),
      skillMode: { grants: async () => ({ platformGrants: ["read:novel"],
        projectGrants: ["read:novel"], runGrants: ["read:novel"],
        roleGrants: ["read:novel"] }) },
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "text-v1",
        maxOutputTokens: 256, contextWindowTokens: 50_000 },
      invokeText: async (callInput) => {
        modelCalls++;
        assert.ok(callInput.messages?.some((message) => message.role === "system"
          && message.content.includes("只读指导 script-guidance-1")));
        const read = callInput.tools!.get_novel_text;
        const denied = await read.execute!({ novelId: 10 },
          { toolCallId: "guarded-tool-call", messages: [] });
        assert.equal((denied as { status: string }).status, "unavailable");
        return { text: "已核对 Skill 授权" } as any;
      } }) });
    const guarded = await guardedRuntime.start({ ...input,
      scope: "script-harness-guidance-v1", clientRequestId: "guarded-script-run" });
    await assert.rejects(guardedRuntime.start({ ...input,
      scope: "script-harness-guidance-v1", actorUserId: 2,
      clientRequestId: "wrong-owner-script-run" }), /Project owner/);
    assert.equal((await db("o_agentRun").where({ clientRequestId: "wrong-owner-script-run" })).length, 0);
    assert.equal(await guardedRuntime.inspect({ runId: guarded.id, projectId: 7,
      actorUserId: 2 }), null);
    assert.equal(await guardedRuntime.cancel({ runId: guarded.id, projectId: 7,
      clientCommandId: "unauthorized-cancel", expectedVersion: 1 }), null);
    assert.deepEqual(await guardedRuntime.list({ projectId: 7, role: "scriptAgent",
      scope: "script-harness-guidance-v1" }), { current: null, recent: [] });
    while (queue.length) await queue.shift()!();
    assert.equal(modelCalls, 1);
    assert.equal(await guardedRuntime.inspect({ runId: guarded.id,
      projectId: 7 }), null, "legacy inspect without actor cannot read a Harness Run");
    assert.equal((await guardedRuntime.inspect({ runId: guarded.id,
      projectId: 7, actorUserId: 1 }))?.status, "succeeded");
    const cancelled = await guardedRuntime.start({ ...input,
      scope: "script-harness-guidance-v1", clientRequestId: "cancel-before-model-run" });
    assert.equal((await guardedRuntime.cancel({ runId: cancelled.id, projectId: 7,
      actorUserId: 1, clientCommandId: "cancel-before-model", expectedVersion: 1 }))?.status,
    "cancelled");
    assert.equal((await guardedRuntime.start({ ...input,
      scope: "script-harness-guidance-v1", clientRequestId: "cancel-before-model-run" })).id,
    cancelled.id, "repeated start cannot revive a cancelled Run");
    while (queue.length) await queue.shift()!();
    assert.equal(modelCalls, 1, "queued callback after cancellation does not invoke Model");
    assert.equal((await db("o_agentToolReceipt").where({ runId: cancelled.id })).length, 0);
    assert.ok((await guardedRuntime.inspect({ runId: cancelled.id,
      projectId: 7, actorUserId: 1 }))?.traces.some((trace) => trace.eventType === "run.cancelled"));
    const reconnectedRuntime = createAgentRuntime({ work, now: () => 325,
      createId, schedule: () => { throw new Error("read-only reconnect must not schedule"); },
      prepareRun: (tx, prepared) => prepareScriptSkillRun(tx, prepared, createId),
      skillMode: { grants: resolveReadOnlyScriptSkillGrants },
      openTextCall: async () => { throw new Error("read-only reconnect must not call Model"); } });
    assert.equal((await reconnectedRuntime.inspect({ runId: cancelled.id,
      projectId: 7, actorUserId: 1 }))?.status, "cancelled");
    assert.ok((await reconnectedRuntime.list({ projectId: 7, role: "scriptAgent",
      scope: "script-harness-guidance-v1", actorUserId: 1 })).recent
      .some((entry) => entry.id === guarded.id && entry.status === "succeeded"));
    const permission = await db("o_agentSkillPermissionDecision")
      .where({ runId: guarded.id, operationId: "guarded-tool-call" }).first();
    assert.equal(JSON.parse(permission.decisionJson).allowed, false);
    assert.equal((await db("o_agentToolReceipt").where({ runId: guarded.id })).length, 0);
    const noCapacityQueue: Array<() => Promise<void>> = [];
    let noCapacityCalls = 0;
    const noCapacityRuntime = createAgentRuntime({ work, now: () => 350,
      createId, schedule: (workItem) => noCapacityQueue.push(workItem),
      prepareRun: (tx, prepared) => prepareScriptSkillRun(tx, prepared, createId),
      skillMode: { grants: async () => ({ platformGrants: [], projectGrants: [],
        runGrants: [], roleGrants: [] }) },
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "no-capacity" },
        invokeText: async () => { noCapacityCalls++; return { text: "unsafe" } as any; } }) });
    const noCapacity = await noCapacityRuntime.start({ ...input,
      scope: "script-harness-guidance-v1", clientRequestId: "no-capacity-script-run" });
    while (noCapacityQueue.length) await noCapacityQueue.shift()!();
    assert.equal(noCapacityCalls, 0);
    assert.equal((await noCapacityRuntime.inspect({ runId: noCapacity.id,
      projectId: 7, actorUserId: 1 }))?.status, "failed");
    const second = await publish("script-guidance-2", ["get_novel_text"]);
    await assert.rejects(runtime.start({ ...input,
      clientRequestId: "ambiguous-script-run" }), /unique selection: needs-attention/);
    assert.equal((await db("o_agentRun").where({ clientRequestId: "ambiguous-script-run" })).length, 0);
    assert.equal((await db("o_agentSkillRouteDecision").where({ runId: run.id })).length, 1);
    assert.equal(scheduled, 1, "ambiguous preparation never schedules a Model");
    await skills.setRevisionLifecycle({ revisionId: first.revisionId,
      expectedVersion: 1, nextState: "revoked" });
    await assert.rejects(createBoundSkillContextSourceLoader(work)
      .load({ runId: run.id, projectId: 7, role: "scriptAgent" }), /revoked or corrupt/);
    await createProjectSkillGrantRuntime({ work, now: () => 400 })
      .setReadNovel({ projectId: 7, actorUserId: 1,
        expectedVersion: 0, active: true });
    const authorizedQueue: Array<() => Promise<void>> = [];
    const authorizedRuntime = createAgentRuntime({ work, now: () => 450,
      createId, schedule: (workItem) => authorizedQueue.push(workItem),
      prepareRun: (tx, prepared) => prepareScriptSkillRun(tx, prepared, createId),
      skillMode: { grants: resolveReadOnlyScriptSkillGrants },
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "text-v2",
        maxOutputTokens: 256, contextWindowTokens: 50_000 },
      invokeText: async (callInput) => {
        assert.ok(callInput.messages?.some((message) => message.role === "system"
          && message.content.includes("只读指导 script-guidance-2")));
        const read = callInput.tools!.get_novel_text;
        const result = await read.execute!({ novelId: 10 },
          { toolCallId: "authorized-v2-read", messages: [] });
        assert.equal((result as { novelId: number }).novelId, 10);
        return { text: "已读取授权章节" } as any;
      } }) });
    const authorized = await authorizedRuntime.start({ ...input,
      scope: "script-harness-guidance-v1", clientRequestId: "authorized-v2-run" });
    while (authorizedQueue.length) await authorizedQueue.shift()!();
    assert.equal((await authorizedRuntime.inspect({ runId: authorized.id,
      projectId: 7, actorUserId: 1 }))?.status, "succeeded");
    assert.equal((await db("o_agentRunSkillBinding").where({ runId: authorized.id }).first())?.revisionId,
      second.revisionId);
    const receipt = await db("o_agentToolReceipt").where({ runId: authorized.id,
      operationId: "authorized-v2-read" }).first();
    assert.equal(receipt.status, "succeeded");
    assert.equal(receipt.toolRevision, HARNESS_TOOL_DEFINITIONS.get_novel_text.revision);
    const readTraces = await db("o_agentTrace").where({ runId: authorized.id,
      toolReceiptId: receipt.id }).orderBy("sequence", "asc");
    assert.deepEqual(readTraces.map((row) => [row.eventType, row.stepId, row.attemptId]), [
      ["tool.started", authorized.steps[0].id, authorized.attempts[0].id],
      ["tool.succeeded", authorized.steps[0].id, authorized.attempts[0].id],
    ], "the guarded Harness read retains its Model Step and Attempt provenance");
    const authority = await db("o_agentSkillPermissionDecision")
      .where({ runId: authorized.id, operationId: "authorized-v2-read" }).first();
    assert.equal(JSON.parse(authority.decisionJson).allowed, true);
    await skills.setRevisionLifecycle({ revisionId: second.revisionId,
      expectedVersion: 1, nextState: "revoked" });
    const workspaceSkill = await publish("script-workspace-read", ["get_script_workspace"]);
    await db("o_agentWorkData").insert({ id: 17, projectId: 7,
      key: "scriptAgent", data: JSON.stringify({ storySkeleton: "本项目故事骨架",
        adaptationStrategy: "本项目改编策略" }) });
    await db("o_project").insert({ id: 9, userId: 2, name: "其他项目" });
    await db("o_agentWorkData").insert({ id: 18, projectId: 9,
      key: "scriptAgent", data: JSON.stringify({ storySkeleton: "其他项目保密骨架" }) });
    const deniedWorkspaceQueue: Array<() => Promise<void>> = [];
    const deniedWorkspaceRuntime = createAgentRuntime({ work, now: () => 455,
      createId, schedule: (workItem) => deniedWorkspaceQueue.push(workItem),
      prepareRun: (tx, prepared) => prepareScriptSkillRun(tx, prepared, createId),
      skillMode: { grants: resolveReadOnlyScriptSkillGrants },
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "workspace-v1",
        maxOutputTokens: 256, contextWindowTokens: 50_000 },
      invokeText: async (callInput) => {
        const result = await callInput.tools!.get_script_workspace.execute!(
          { key: "storySkeleton" }, { toolCallId: "workspace-denied-1", messages: [] });
        assert.equal((result as { status: string }).status, "unavailable");
        return { text: "未获工作区读取授权" } as any;
      } }) });
    const deniedWorkspaceRun = await deniedWorkspaceRuntime.start({ ...input,
      scope: "script-harness-guidance-v1", clientRequestId: "workspace-denied-run" });
    while (deniedWorkspaceQueue.length) await deniedWorkspaceQueue.shift()!();
    assert.equal((await db("o_agentToolReceipt").where({ runId: deniedWorkspaceRun.id })).length, 0);
    assert.equal(JSON.parse((await db("o_agentSkillPermissionDecision")
      .where({ runId: deniedWorkspaceRun.id, operationId: "workspace-denied-1" }).first())
      .decisionJson).allowed, false);
    const workspaceGrants = createProjectSkillGrantRuntime({ work, now: () => 460 });
    await workspaceGrants.setReadScriptWorkspace({ projectId: 7, actorUserId: 1,
      expectedVersion: 0, active: true });
    const workspaceQueue: Array<() => Promise<void>> = [];
    const workspaceRuntime = createAgentRuntime({ work, now: () => 470,
      createId, schedule: (workItem) => workspaceQueue.push(workItem),
      prepareRun: (tx, prepared) => prepareScriptSkillRun(tx, prepared, createId),
      skillMode: { grants: resolveReadOnlyScriptSkillGrants },
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "workspace-v1",
        maxOutputTokens: 256, contextWindowTokens: 50_000 },
      invokeText: async (callInput) => {
        const result = await callInput.tools!.get_script_workspace.execute!(
          { key: "storySkeleton" }, { toolCallId: "workspace-read-1", messages: [] });
        assert.deepEqual(result, { key: "storySkeleton", content: "本项目故事骨架" });
        await workspaceGrants.setReadScriptWorkspace({ projectId: 7,
          actorUserId: 1, expectedVersion: 1, active: false });
        const revoked = await callInput.tools!.get_script_workspace.execute!(
          { key: "adaptationStrategy" }, { toolCallId: "workspace-revoked-2", messages: [] });
        assert.equal((revoked as { status: string }).status, "unavailable");
        return { text: "已读取规划工作区" } as any;
      } }) });
    const workspaceRun = await workspaceRuntime.start({ ...input,
      scope: "script-harness-guidance-v1", clientRequestId: "workspace-read-run" });
    while (workspaceQueue.length) await workspaceQueue.shift()!();
    assert.equal((await workspaceRuntime.inspect({ runId: workspaceRun.id,
      projectId: 7, actorUserId: 1 }))?.status, "succeeded");
    assert.equal((await db("o_agentRunSkillBinding").where({ runId: workspaceRun.id }).first())?.revisionId,
      workspaceSkill.revisionId);
    const workspaceReceipt = await db("o_agentToolReceipt").where({ runId: workspaceRun.id,
      operationId: "workspace-read-1" }).first();
    assert.equal(workspaceReceipt?.toolRevision,
    HARNESS_TOOL_DEFINITIONS.get_script_workspace.revision);
    const workspaceSuccess = await db("o_agentTrace").where({ runId: workspaceRun.id,
      toolReceiptId: workspaceReceipt.id, eventType: "tool.succeeded" }).first();
    assert.equal(workspaceSuccess?.stepId, workspaceRun.steps[0].id);
    assert.equal(workspaceSuccess?.attemptId, workspaceRun.attempts[0].id);
    assert.equal((await db("o_agentToolReceipt").where({ runId: workspaceRun.id,
      operationId: "workspace-revoked-2" })).length, 0);
    assert.equal(JSON.parse((await db("o_agentSkillPermissionDecision")
      .where({ runId: workspaceRun.id, operationId: "workspace-revoked-2" }).first())
      .decisionJson).allowed, false);
    await skills.setRevisionLifecycle({ revisionId: workspaceSkill.revisionId,
      expectedVersion: 1, nextState: "revoked" });
    const scriptSkill = await publish("script-content-read", ["get_script_content"]);
    await db("o_script").insert([{ id: 21, projectId: 7,
      name: "第一集", content: "本项目剧本" },
    { id: 22, projectId: 9, name: "其他集", content: "其他项目私有剧本" }]);
    const scriptQueue: Array<() => Promise<void>> = [];
    const scriptRuntime = createAgentRuntime({ work, now: () => 480,
      createId, schedule: (workItem) => scriptQueue.push(workItem),
      prepareRun: (tx, prepared) => prepareScriptSkillRun(tx, prepared, createId),
      skillMode: { grants: resolveReadOnlyScriptSkillGrants },
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "script-read-v1",
        maxOutputTokens: 256, contextWindowTokens: 50_000 },
      invokeText: async (callInput) => {
        const denied = await callInput.tools!.get_script_content.execute!(
          { scriptId: 21 }, { toolCallId: "script-denied-1", messages: [] });
        assert.equal((denied as { status: string }).status, "unavailable");
        return { text: "剧本读取未授权" } as any;
      } }) });
    const deniedScriptRun = await scriptRuntime.start({ ...input,
      scope: "script-harness-guidance-v1", clientRequestId: "script-denied-run" });
    while (scriptQueue.length) await scriptQueue.shift()!();
    assert.equal((await db("o_agentToolReceipt").where({ runId: deniedScriptRun.id })).length, 0);
    await createProjectSkillGrantRuntime({ work, now: () => 485 })
      .setReadScript({ projectId: 7, actorUserId: 1,
        expectedVersion: 0, active: true });
    const allowedScriptQueue: Array<() => Promise<void>> = [];
    const allowedScriptRuntime = createAgentRuntime({ work, now: () => 490,
      createId, schedule: (workItem) => allowedScriptQueue.push(workItem),
      prepareRun: (tx, prepared) => prepareScriptSkillRun(tx, prepared, createId),
      skillMode: { grants: resolveReadOnlyScriptSkillGrants },
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "script-read-v1",
        maxOutputTokens: 256, contextWindowTokens: 50_000 },
      invokeText: async (callInput) => {
        const own = await callInput.tools!.get_script_content.execute!(
          { scriptId: 21 }, { toolCallId: "script-own-1", messages: [] });
        assert.deepEqual(own, { scriptId: 21, name: "第一集", content: "本项目剧本" });
        const foreign = await callInput.tools!.get_script_content.execute!(
          { scriptId: 22 }, { toolCallId: "script-foreign-2", messages: [] });
        assert.equal((foreign as { status: string }).status, "unavailable");
        return { text: "已核对本项目剧本" } as any;
      } }) });
    const scriptRun = await allowedScriptRuntime.start({ ...input,
      scope: "script-harness-guidance-v1", clientRequestId: "script-allowed-run" });
    while (allowedScriptQueue.length) await allowedScriptQueue.shift()!();
    assert.equal((await allowedScriptRuntime.inspect({ runId: scriptRun.id,
      projectId: 7, actorUserId: 1 }))?.status, "succeeded");
    assert.equal((await db("o_agentRunSkillBinding").where({ runId: scriptRun.id }).first())?.revisionId,
      scriptSkill.revisionId);
    assert.equal((await db("o_agentToolReceipt").where({ runId: scriptRun.id,
      operationId: "script-own-1" }).first())?.toolRevision,
    HARNESS_TOOL_DEFINITIONS.get_script_content.revision);
    assert.equal((await db("o_agentToolReceipt").where({ runId: scriptRun.id,
      operationId: "script-foreign-2" }).first())?.status, "failed");
  } finally { await db.destroy(); }
});
