import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime, PRODUCTION_HARNESS_ROLE,
  PRODUCTION_HARNESS_SCOPE } from "../src/agentRuntime";
import { prepareProductionSkillRun } from
  "../src/agents/productionAgent/harnessPreparation";
import { createProductionHarnessEffects,
  ProductionHarnessEffectsNotFoundError } from
  "../src/agents/productionAgent/harnessEffects";
import { createBillableImageApprovalRuntime } from
  "../src/controlledTools/billableImageApproval";
import { createBillableImageArtifactRuntime } from
  "../src/controlledTools/billableImageArtifact";
import { createBillableImageCommitRuntime } from
  "../src/controlledTools/billableImageCommit";
import { createBillableImageExecution, type BillableImageExecutionDependencies } from
  "../src/controlledTools/billableImageExecution";
import { createBillableImageLedger } from
  "../src/controlledTools/billableImageLedger";
import { createDerivedAssetWriteRuntime } from
  "../src/controlledTools/derivedAssetWrite";
import { billableImageScopeSchema } from
  "../src/controlledTools/billableImageLifecycle";
import initDB from "../src/lib/initDB";
import { recoverInterruptedAgentRuns } from "../src/database/agentRunRecovery";
import { createSkillRuntime } from "../src/skillRuntime";
import { createProjectSkillGrantRuntime, resolveProductionSkillGrants } from
  "../src/skillRuntime/grants";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from
  "../src/skillRuntime/manifest";

test("Production Run links guarded reads, owner-approved image effects and ambiguous Vendor outcomes", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert({ id: 7, userId: 1, name: "生产项目" });
    await db("o_script").insert({ id: 11, projectId: 7, name: "第一集",
      content: "剧本内容" });
    await db("o_assets").insert({ id: 21, projectId: 7,
      type: "role", name: "主角" });
    await db("o_assets").insert({ id: 22, projectId: 7,
      type: "role", name: "配角" });
    await db("o_agentWorkData").insert({ projectId: 7, episodesId: 11,
      key: "productionAgent", data: JSON.stringify({ scriptPlan: "三段拍摄计划" }) });
    let serial = 0;
    const createId = () => `production-run-${++serial}`;
    const work = async <T>(operation: (database: typeof db) => Promise<T> | T) => operation(db);
    const skills = createSkillRuntime({ work, now: () => 100, createId });
    const definition = await skills.createDefinition({
      name: "production-guidance", description: "只读生产规划" });
    const manifest: SkillManifest = { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
      skillId: definition.id, semanticVersion: "1.0.0",
      compatibleRoles: ["productionAgent"], intents: ["read-only-guidance"],
      dependencies: [], requestedTools: ["get_production_workspace_text",
        "propose_asset_image_generation", "propose_derived_asset_write"],
      requestedCapabilities: ["read:production-workspace", "propose:billable-image",
        "propose:derived-asset"],
      resources: [],
      routing: { priority: 1, keywords: [] }, attribution: "T17 定向测试" };
    const draft = await skills.saveDraft({ skillId: definition.id,
      semanticVersion: "1.0.0", content: "只读检查拍摄计划", manifest });
    await skills.publish({ revisionId: draft.id,
      expectedContentHash: draft.contentHash });
    await skills.activate({ skillId: definition.id, revisionId: draft.id,
      expectedBindingVersion: 0 });
    const projectGrants = createProjectSkillGrantRuntime({ work, now: () => 150 });
    await projectGrants.setReadProductionWorkspace({ projectId: 7, actorUserId: 1,
        expectedVersion: 0, active: true });
    await projectGrants.setProposeBillableImage({ projectId: 7, actorUserId: 1,
        expectedVersion: 0, active: true });
    await projectGrants.setProposeDerivedAsset({ projectId: 7, actorUserId: 1,
        expectedVersion: 0, active: true });
    const derivedAsset = createDerivedAssetWriteRuntime({ work,
      now: () => 200, createId });
    const imageApproval = createBillableImageApprovalRuntime({ work,
      now: () => 200, createId,
      quote: async () => ({ estimatedMaxCostMicros: 200_000,
        currency: "USD" }),
      preflight: async (_tx, scope) => ({ targetStateHash: "a".repeat(64),
        preview: { assetId: scope.assetId, assetName: "主角",
          vendorId: scope.vendorId, modelId: scope.modelId,
          resolution: scope.resolution,
          estimatedMaxCostMicros: scope.estimatedMaxCostMicros,
          currency: scope.currency, disclaimer: "预估费用并非最终账单" } }) });
    const queue: Array<() => Promise<void>> = [];
    let modelCalls = 0;
    let modelEntered!: () => void;
    let releaseModel!: () => void;
    const enteredModel = new Promise<void>((resolve) => { modelEntered = resolve; });
    const heldModel = new Promise<void>((resolve) => { releaseModel = resolve; });
    const runtime = createAgentRuntime({ work, now: () => 200, createId,
      schedule: (item) => queue.push(item), productionMode: true,
      prepareRun: (tx, input) => prepareProductionSkillRun(tx, input, createId),
      skillMode: { grants: resolveProductionSkillGrants },
      proposeBillableImage: (input) => imageApproval.proposeFromAgent(input),
      proposeDerivedAsset: (input) => derivedAsset.proposeFromAgent(input),
      openTextCall: async (target) => {
        assert.deepEqual(target, { kind: "logical", key: "productionAgent:decisionAgent" });
        return { target: { vendorId: "fake", modelId: "text-v1",
          contextWindowTokens: 50_000, maxOutputTokens: 256 },
          invokeText: async (callInput) => {
            modelCalls++;
            if (callInput.messages?.some((message) =>
              typeof message.content === "string" && message.content.includes("挂起模型调用"))) {
              modelEntered();
              await heldModel;
              return { text: "迟到的模型结果不应提交" } as any;
            }
            assert.deepEqual(Object.keys(callInput.tools!), ["get_production_workspace_text",
              "propose_asset_image_generation", "propose_derived_asset_write"]);
            const result = await callInput.tools!.get_production_workspace_text.execute!(
              { scriptId: 11, key: "scriptPlan" },
              { toolCallId: "production-read-one", messages: [] });
            assert.equal((result as { content?: string }).content, "三段拍摄计划");
            const proposed = await callInput.tools!.propose_asset_image_generation.execute!(
              { assetId: 21, vendorId: "vendor", modelId: "image-v1",
                resolution: "1024x1024" },
              { toolCallId: "production-image-proposal-one", messages: [] });
            assert.equal((proposed as { status?: string }).status, "pending");
            const repeated = await callInput.tools!.propose_asset_image_generation.execute!(
              { assetId: 21, vendorId: "vendor", modelId: "image-v1",
                resolution: "1024x1024" },
              { toolCallId: "production-image-proposal-one", messages: [] });
            assert.deepEqual(repeated, proposed,
              "repeating one model operation returns the same durable child approval");
            const changedTarget = await callInput.tools!.propose_asset_image_generation.execute!(
              { assetId: 21, vendorId: "vendor", modelId: "image-v1",
                resolution: "512x512" },
              { toolCallId: "production-image-proposal-one", messages: [] });
            assert.equal((changedTarget as { status?: string }).status, "unavailable",
              "the same operation cannot silently change its target");
            const timeoutCandidate = await callInput.tools!.propose_asset_image_generation.execute!(
              { assetId: 22, vendorId: "vendor", modelId: "image-v1",
                resolution: "1024x1024" },
              { toolCallId: "production-image-proposal-timeout", messages: [] });
            assert.equal((timeoutCandidate as { status?: string }).status, "pending");
            assert.equal((await db("o_agentVendorRequest")).length, 0,
              "model proposal cannot submit to Vendor");
            const parent = await db("o_agentRun").where({ role: PRODUCTION_HARNESS_ROLE,
              scope: PRODUCTION_HARNESS_SCOPE, status: "running" }).first();
            await assert.rejects(imageApproval.proposeFromAgent({ projectId: 7,
              parentRunId: parent.id, skillId: definition.id,
              lease: { runId: parent.id, ownerId: parent.leaseOwnerId,
                epoch: parent.leaseEpoch, fence: parent.fence + 1,
                expiresAt: parent.leaseExpiresAt },
              operationId: "forged-lease-image-proposal", assetId: 21,
              vendorId: "vendor", modelId: "image-v1", resolution: "1024x1024" }),
            /所有权已失效/,
            "a stale or forged lease cannot create an approval");
            await projectGrants.setProposeBillableImage({ projectId: 7,
              actorUserId: 1, expectedVersion: 1, active: false });
            const denied = await callInput.tools!.propose_asset_image_generation.execute!(
              { assetId: 21, vendorId: "vendor", modelId: "image-v1",
                resolution: "1024x1024" },
              { toolCallId: "production-image-proposal-two", messages: [] });
            assert.equal((denied as { status?: string }).status, "denied");
            const derivedPayload = { parentAssetId: 21, assetId: null,
              expectedVersion: 0, scriptId: 11, name: "主角蓝衣版本",
              description: "第一集服装变化", changeInstruction: {
                dimensions: ["wardrobe"], evidence: ["剧本第一场更换外套"],
                preserve: ["面部身份"], change: ["外套改为蓝色"], exclude: [],
              } };
            const derived = await callInput.tools!.propose_derived_asset_write.execute!(
              derivedPayload, { toolCallId: "production-derived-one", messages: [] });
            assert.equal((derived as { status?: string }).status, "pending");
            assert.deepEqual(await callInput.tools!.propose_derived_asset_write.execute!(
              derivedPayload, { toolCallId: "production-derived-one", messages: [] }), derived);
            const derivedChanged = await callInput.tools!.propose_derived_asset_write.execute!(
              { ...derivedPayload, name: "另一个版本" },
              { toolCallId: "production-derived-one", messages: [] });
            assert.equal((derivedChanged as { status?: string }).status, "unavailable",
              "one operation cannot change the pending derived Asset payload");
            await assert.rejects(derivedAsset.proposeFromAgent({ projectId: 7,
              parentRunId: parent.id, skillId: definition.id,
              lease: { runId: parent.id, ownerId: parent.leaseOwnerId,
                epoch: parent.leaseEpoch, fence: parent.fence + 1,
                expiresAt: parent.leaseExpiresAt },
              operationId: "forged-lease-derived-proposal", payload: derivedPayload }),
            /所有权已失效/);
            assert.equal((await db("o_assets")).length, 2,
              "model proposal must not write a derived Asset");
            await projectGrants.setProposeDerivedAsset({ projectId: 7,
              actorUserId: 1, expectedVersion: 1, active: false });
            const derivedDenied = await callInput.tools!.propose_derived_asset_write.execute!(
              derivedPayload, { toolCallId: "production-derived-two", messages: [] });
            assert.equal((derivedDenied as { status?: string }).status, "denied");
            return { text: "拍摄计划已核对；未执行生成" } as any;
          } };
      } });
    const input = { schemaVersion: "toonflow.agent-run.start.v1" as const,
      projectId: 7, role: PRODUCTION_HARNESS_ROLE,
      scope: PRODUCTION_HARNESS_SCOPE, clientRequestId: "production-guidance-1",
      content: "检查第一集拍摄计划", actorUserId: 1 };
    const run = await runtime.start(input);
    assert.equal((await db("o_agentRunSkillBinding").where({ runId: run.id }).first())?.revisionId,
      draft.id);
    await assert.rejects(runtime.start({ ...input,
      clientRequestId: "wrong-owner-production", actorUserId: 2 }), /Project owner/);
    assert.equal(await runtime.inspect({ runId: run.id, projectId: 7,
      actorUserId: 2 }), null);
    assert.equal(await runtime.inspect({ runId: run.id, projectId: 7 }), null);
    assert.deepEqual(await runtime.list({ projectId: 7, role: PRODUCTION_HARNESS_ROLE,
      scope: PRODUCTION_HARNESS_SCOPE, actorUserId: 2 }),
    { current: null, recent: [] });
    while (queue.length) await queue.shift()!();
    assert.equal(modelCalls, 1);
    assert.equal((await runtime.inspect({ runId: run.id, projectId: 7,
      actorUserId: 1 }))?.status, "succeeded");
    assert.equal((await db("o_agentToolReceipt").where({ runId: run.id,
      toolName: "get_production_workspace_text", status: "succeeded" })).length, 1);
    assert.equal((await db("o_agentSkillPermissionDecision").where({ runId: run.id })).length, 6);
    const derivedRun = await db("o_agentRun").where({ projectId: 7,
      scope: "approved-derived-asset-write-v1" }).first();
    assert.ok(derivedRun);
    const pendingDerived = await derivedAsset.inspect(7, derivedRun.id, 1);
    assert.equal(pendingDerived?.sourceRunId, run.id);
    assert.equal(pendingDerived?.sourceOperationId, "production-derived-one");
    assert.equal(pendingDerived?.status, "pending");
    const approvedDerived = await derivedAsset.decide({ projectId: 7,
      runId: derivedRun.id, approvalId: pendingDerived!.id,
      clientCommandId: "approve-production-derived", expectedVersion: pendingDerived!.runVersion,
      actorUserId: 1, decision: "approve" });
    assert.equal(approvedDerived?.status, "approved");
    assert.equal((await db("o_assets").where({ assetsId: 21 })).length, 1);
    const imageProposals = await db("o_agentRun")
      .where({ projectId: 7, scope: "approved-billable-image-v1" });
    const imageProposal = imageProposals.find((row) =>
      JSON.parse(row.input).parentOperationId === "production-image-proposal-one");
    const timeoutProposal = imageProposals.find((row) =>
      JSON.parse(row.input).parentOperationId === "production-image-proposal-timeout");
    assert.ok(imageProposal);
    assert.ok(timeoutProposal);
    const pendingImage = await imageApproval.inspect(7, imageProposal.id, 1);
    assert.equal(pendingImage?.sourceRunId, run.id);
    await assert.rejects(db("o_agentToolApproval")
      .where({ runId: imageProposal.id })
      .update({ operationId: "tampered-parent-operation" }),
    /Agent Tool approval binding is immutable/,
    "the database must reject a rewritten source operation");
    assert.equal((await db("o_agentRun").where({ projectId: 7,
      scope: "approved-billable-image-v1" })).length, 2,
    "revocation cannot create another approval Run");
    assert.equal((await db("o_agentVendorRequest")).length, 0);
    await assert.rejects(imageApproval.decide({ projectId: 7, actorUserId: 2,
      runId: imageProposal.id, approvalId: pendingImage!.id,
      clientCommandId: "foreign-approve", expectedVersion: pendingImage!.runVersion,
      decision: "approve" }), /billable image ledger conflict/i);
    const approvedImage = await imageApproval.decide({ projectId: 7,
      actorUserId: 1, runId: imageProposal.id, approvalId: pendingImage!.id,
      clientCommandId: "owner-approve", expectedVersion: pendingImage!.runVersion,
      decision: "approve" });
    assert.equal(approvedImage?.status, "approved");
    assert.equal((await db("o_agentVendorRequest")).length, 0);
    const ledger = createBillableImageLedger({ work, now: () => 210, createId,
      verifyPreflight: async () => "a".repeat(64) });
    const media = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
    const storedMedia = new Map<string, Buffer>();
    const artifact = createBillableImageArtifactRuntime({ work, now: () => 211,
      createId, writeMedia: async (path, base64) => {
        storedMedia.set(path, Buffer.from(base64, "base64"));
      }, readMedia: async (path) => storedMedia.get(path)! });
    const commit = createBillableImageCommitRuntime({ work, now: () => 212,
      createId, verifyPreflight: async () => "a".repeat(64) });
    let providerCalls = 0;
    const executionDependencies: BillableImageExecutionDependencies = {
      prepare: async () => ({ target: { vendorId: "vendor", modelId: "image-v1" },
        input: { prompt: "已冻结的单资产图片生成提示", size: "1K", aspectRatio: "1:1" } }),
      preflight: async () => "a".repeat(64),
      dispatch: (input) => ledger.dispatch(input),
      invoke: async () => { providerCalls++; return media; },
      markSubmissionAmbiguous: (requestId) => ledger.markSubmissionAmbiguous(requestId),
      observe: (requestId, base64) => artifact.observe(requestId, base64),
      currentRunVersion: async (runId, projectId) => Number((await db("o_agentRun")
        .where({ id: runId, projectId }).first("version")).version),
      commit: (input) => commit.commit(input),
    };
    const execute = createBillableImageExecution(executionDependencies);
    const approvalRecord = await db("o_agentToolApproval")
      .where({ runId: imageProposal.id }).first("payloadJson");
    const scope = billableImageScopeSchema.parse(JSON.parse(approvalRecord.payloadJson));
    const completedImage = await execute({ projectId: 7, actorUserId: 1,
      runId: imageProposal.id, approvalId: pendingImage!.id,
      expectedVersion: approvedImage!.runVersion, scope });
    assert.equal(completedImage.status, "succeeded");
    assert.equal(providerCalls, 1);
    assert.equal((await db("o_agentVendorRequest")).length, 1);
    assert.equal((await db("o_agentImageArtifact")).length, 1);
    assert.equal((await db("o_assets").where({ id: 21 }).first()).imageId,
      completedImage.status === "succeeded" ? completedImage.output.imageId : -1);
    assert.equal((await db("o_agentRun").where({ id: imageProposal.id }).first()).status,
      "succeeded");
    assert.equal((await execute({ projectId: 7, actorUserId: 1,
      runId: imageProposal.id, approvalId: pendingImage!.id,
      expectedVersion: approvedImage!.runVersion, scope })).status, "not-dispatched");
    assert.equal(providerCalls, 1, "a completed child approval never replays the Provider");
    const acceptedTrace = await db("o_agentTrace").where({ runId: imageProposal.id,
      eventType: "tool.billable-image.committed" }).first("vendorRequestId", "imageArtifactId");
    assert.ok(acceptedTrace?.vendorRequestId);
    assert.ok(acceptedTrace?.imageArtifactId);
    const pendingTimeout = await imageApproval.inspect(7, timeoutProposal.id, 1);
    assert.equal(pendingTimeout?.sourceRunId, run.id);
    const approvedTimeout = await imageApproval.decide({ projectId: 7,
      actorUserId: 1, runId: timeoutProposal.id, approvalId: pendingTimeout!.id,
      clientCommandId: "owner-approve-timeout", expectedVersion: pendingTimeout!.runVersion,
      decision: "approve" });
    const timeoutRecord = await db("o_agentToolApproval")
      .where({ runId: timeoutProposal.id }).first("payloadJson");
    const timeoutScope = billableImageScopeSchema.parse(JSON.parse(timeoutRecord.payloadJson));
    let timeoutProviderCalls = 0;
    const timeoutExecute = createBillableImageExecution({ ...executionDependencies,
      invoke: async () => { timeoutProviderCalls++; throw new Error("ambiguous provider timeout"); } });
    const timeoutCommand = { projectId: 7, actorUserId: 1,
      runId: timeoutProposal.id, approvalId: pendingTimeout!.id,
      expectedVersion: approvedTimeout!.runVersion, scope: timeoutScope };
    const unknown = await timeoutExecute(timeoutCommand);
    assert.equal(unknown.status, "unknown");
    assert.equal(timeoutProviderCalls, 1);
    assert.equal((await timeoutExecute(timeoutCommand)).status, "not-dispatched");
    assert.equal(timeoutProviderCalls, 1, "an ambiguous submission cannot be replayed");
    const requestId = unknown.requestId;
    assert.equal((await db("o_agentVendorRequest").where({ requestId }).first()).status,
      "unknown");
    const timeoutRun = await db("o_agentRun").where({ id: timeoutProposal.id }).first();
    await ledger.requestCancellation({ projectId: 7, actorUserId: 1,
      requestId, expectedVersion: timeoutRun.version });
    assert.equal((await artifact.observe(requestId, media)).status, "late");
    assert.equal((await db("o_assets").where({ id: 22 }).first()).imageId, null);
    assert.notEqual((await db("o_agentRun").where({ id: timeoutProposal.id }).first()).status,
      "succeeded", "late media is evidence, not a completed effect");
    const effects = createProductionHarnessEffects({ work,
      inspectBillable: (projectId, runId, actorUserId) =>
        imageApproval.inspect(projectId, runId, actorUserId) });
    await assert.rejects(effects({ projectId: 7, actorUserId: 2,
      runId: run.id }), ProductionHarnessEffectsNotFoundError);
    const projected = await effects({ projectId: 7, actorUserId: 1, runId: run.id });
    assert.equal(projected.effects.length, 3);
    assert.equal(projected.effects.find((item) =>
      item.operationId === "production-image-proposal-two")?.status, "denied");
    assert.equal(projected.effects.find((item) =>
      item.operationId === "production-image-proposal-one")?.approval?.runStatus,
    "succeeded");
    assert.equal(projected.effects.find((item) =>
      item.operationId === "production-image-proposal-timeout")?.approval?.vendorRequest?.status,
    "late_artifact_observed");
    assert.equal((await runtime.inspect({ runId: run.id, projectId: 7,
      actorUserId: 1 }))?.status, "succeeded",
    "Owner decision on the child must not rewrite the parent guidance result");
    assert.equal((await runtime.start(input)).id, run.id);
    assert.equal(modelCalls, 1, "idempotent retry never calls Model again");
    const cancelled = await runtime.start({ ...input,
      clientRequestId: "production-cancel-before-model" });
    assert.equal((await runtime.cancel({ runId: cancelled.id, projectId: 7,
      actorUserId: 1, clientCommandId: "stop-production", expectedVersion: 1 }))?.status,
    "cancelled");
    while (queue.length) await queue.shift()!();
    assert.equal(modelCalls, 1, "cancelled queued Run never calls Model");
    const interrupted = await runtime.start({ ...input,
      clientRequestId: "production-restart-before-model" });
    await recoverInterruptedAgentRuns(db, 5_000);
    assert.equal((await runtime.inspect({ runId: interrupted.id, projectId: 7,
      actorUserId: 1 }))?.status, "waiting");
    assert.equal((await db("o_agentRunAttempt")
      .where({ runId: interrupted.id })).length, 2,
    "pre-intent restart records a successor Attempt without calling the Model");
    while (queue.length) await queue.shift()!();
    assert.equal(modelCalls, 1, "recovered Production Run is not silently replayed");
    const ambiguousModel = await runtime.start({ ...input,
      clientRequestId: "production-restart-after-model-intent",
      content: "挂起模型调用" });
    const pendingWorker = queue.shift()!().catch(() => undefined);
    await enteredModel;
    await recoverInterruptedAgentRuns(db, 70_000);
    const parked = await runtime.inspect({ runId: ambiguousModel.id,
      projectId: 7, actorUserId: 1 });
    assert.equal(parked?.status, "waiting");
    assert.equal(parked?.attentionReason, "interrupted-model-call");
    assert.equal((await db("o_agentRunAttempt")
      .where({ runId: ambiguousModel.id })).length, 1,
    "post-intent recovery must not create a replay Attempt");
    releaseModel();
    await pendingWorker;
    assert.equal((await runtime.inspect({ runId: ambiguousModel.id,
      projectId: 7, actorUserId: 1 }))?.status, "waiting");
    assert.equal(modelCalls, 2, "late Model completion cannot revive the parked Run");
    const scriptRuntime = createAgentRuntime({ work, now: () => 220, createId,
      schedule: () => { throw new Error("default Runtime must not schedule"); },
      openTextCall: async () => { throw new Error("default Runtime must not call Model"); } });
    assert.equal(await scriptRuntime.inspect({ runId: run.id, projectId: 7,
      actorUserId: 1 }), null, "Script Runtime cannot inspect a Production Run");
  } finally { await db.destroy(); }
});
