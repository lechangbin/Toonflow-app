import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { createAgentRuntime, PRODUCTION_HARNESS_ROLE,
  PRODUCTION_HARNESS_SCOPE } from "../src/agentRuntime";
import { createProductionHarnessEffects } from
  "../src/agents/productionAgent/harnessEffects";
import { prepareProductionSkillRun } from
  "../src/agents/productionAgent/harnessPreparation";
import { createVideoApprovalScope } from
  "../src/controlledTools/videoApprovalScope";
import { createVideoGenerationApprovalRuntime } from
  "../src/controlledTools/videoGenerationApproval";
import { freezeVideoGenerationProposal } from
  "../src/controlledTools/videoGenerationProposalContract";
import { createVideoQuotePolicy } from
  "../src/controlledTools/videoQuotePolicy";
import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { createProjectSkillGrantRuntime, resolveProductionSkillGrants } from
  "../src/skillRuntime/grants";
import { SKILL_MANIFEST_SCHEMA_VERSION, type SkillManifest } from
  "../src/skillRuntime/manifest";
import { workOf } from "./databaseTestSupport";

const output = { presetId: "720p", duration: 5,
  resolution: "720p", aspectRatio: "16:9" as const };
const audio = { generation: "native" as const, enabled: true };
const payload = { scriptId: 11, item: { trackId: 31, promptRevisionId: 51,
  vendorId: "agnes", modelId: "agnes-video-v2.0",
  capabilityId: "text-to-video" as const, inputs: [], output, audio } };

test("Production model may only propose one authorized Video child for Owner review", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert({ id: 7, userId: 1, name: "生产项目" });
    await db("o_script").insert({ id: 11, projectId: 7, name: "第一集" });
    await db("o_videoTrack").insert({ id: 31, projectId: 7, scriptId: 11,
      state: "已完成", duration: 5, promptRevisionId: 51,
      vendorId: "agnes", modelId: "agnes-video-v2.0",
      capabilityId: "text-to-video", inputRefs: "[]",
      outputSelection: JSON.stringify(output), audioSelection: JSON.stringify(audio) });
    await db("o_promptRevision").insert({ id: 51, projectId: 7,
      videoTrackId: 31, status: "active", profileId: "agnes/text-v1",
      strategy: "custom", brief: "{}", draft: "{}",
      renderedPrompt: "A lantern sways", createdAt: 100 });
    let serial = 0;
    const createId = () => `proposal-${++serial}`;
    const work = workOf(db);
    const skills = createSkillRuntime({ work, now: () => 100, createId });
    const definition = await skills.createDefinition({
      name: "video-proposal-guidance", description: "视频候选" });
    const manifest: SkillManifest = { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
      skillId: definition.id, semanticVersion: "1.0.0",
      compatibleRoles: ["productionAgent"], intents: ["read-only-guidance"],
      dependencies: [], requestedTools: ["propose_track_video_generation"],
      requestedCapabilities: ["propose:track-video"], resources: [],
      routing: { priority: 1, keywords: [] }, attribution: "T17 定向测试" };
    const draft = await skills.saveDraft({ skillId: definition.id,
      semanticVersion: "1.0.0", content: "仅提出视频候选", manifest });
    await skills.publish({ revisionId: draft.id,
      expectedContentHash: draft.contentHash });
    await skills.activate({ skillId: definition.id, revisionId: draft.id,
      expectedBindingVersion: 0 });
    const grants = createProjectSkillGrantRuntime({ work, now: () => 150 });
    await grants.setProposeVideo({ projectId: 7, actorUserId: 1,
      expectedVersion: 0, active: true });
    const quote = createVideoQuotePolicy({ work, now: () => 100, createId });
    await quote.set({ projectId: 7, actorUserId: 1,
      vendorId: "agnes", modelId: "agnes-video-v2.0",
      capabilityId: "text-to-video", output, audio, expectedRevision: 0,
      estimatedMaxCostMicros: 250_000, currency: "USD" });
    const scope = createVideoApprovalScope({
      prepare: async (projectId, raw) => {
        const frozen = await work((current) =>
          freezeVideoGenerationProposal(current, projectId, raw));
        return { payload: frozen.payload, payloadHash: frozen.payloadHash,
          targetStateHash: frozen.targetStateHash,
          commandHash: "c".repeat(64), preview: frozen.preview };
      },
      quote: (target) => quote.quote(target),
    });
    const approval = createVideoGenerationApprovalRuntime({ work,
      now: () => 200, createId, scope,
      quoteInTransaction: (tx, target) => quote.quote(target, tx) });
    const queue: Array<() => Promise<void>> = [];
    const runtime = createAgentRuntime({ work, now: () => 200, createId,
      productionMode: true, schedule: (item) => queue.push(item),
      prepareRun: (tx, input) => prepareProductionSkillRun(tx, input, createId),
      skillMode: { grants: resolveProductionSkillGrants },
      proposeVideo: (input) => approval.proposeFromAgent(input),
      openTextCall: async () => ({ target: { vendorId: "fake", modelId: "text-v1",
        contextWindowTokens: 50_000, maxOutputTokens: 256 },
        invokeText: async (callInput) => {
          assert.deepEqual(Object.keys(callInput.tools!),
            ["get_production_workspace_text", "propose_track_video_generation"]);
          const proposed = await callInput.tools!.propose_track_video_generation.execute!(
            payload, { toolCallId: "video-operation-1", messages: [] });
          assert.equal((proposed as { status?: string }).status, "pending");
          assert.deepEqual(await callInput.tools!.propose_track_video_generation.execute!(
            payload, { toolCallId: "video-operation-1", messages: [] }), proposed);
          assert.equal((await callInput.tools!.propose_track_video_generation.execute!(
            { ...payload, item: { ...payload.item, promptRevisionId: 52 } },
            { toolCallId: "video-operation-1", messages: [] }) as { status?: string }).status,
          "unavailable");
          assert.equal((await db("o_agentVideoVendorRequest")).length, 0);
          await grants.setProposeVideo({ projectId: 7, actorUserId: 1,
            expectedVersion: 1, active: false });
          const denied = await callInput.tools!.propose_track_video_generation.execute!(
            payload, { toolCallId: "video-operation-2", messages: [] });
          assert.equal((denied as { status?: string }).status, "denied");
          return { text: "视频候选待 Owner 审批" } as any;
        } }),
    });
    const parent = await runtime.start({ schemaVersion: "toonflow.agent-run.start.v1",
      projectId: 7, role: PRODUCTION_HARNESS_ROLE,
      scope: PRODUCTION_HARNESS_SCOPE, clientRequestId: "video-parent-1",
      content: "提出视频候选", actorUserId: 1 });
    while (queue.length) await queue.shift()!();
    assert.equal((await runtime.inspect({ runId: parent.id,
      projectId: 7, actorUserId: 1 }))?.status, "succeeded");
    const child = await db("o_agentRun").where({ projectId: 7,
      scope: "approved-billable-video-v1" }).first();
    assert(child);
    const pending = await approval.inspect(7, child.id, 1);
    assert.equal(pending?.sourceRunId, parent.id);
    assert.equal(pending?.sourceOperationId, "video-operation-1");
    assert.equal(pending?.status, "pending");
    assert.equal((await db("o_agentVideoVendorRequest")).length, 0);
    const effects = createProductionHarnessEffects({ work,
      inspectBillable: async () => null, inspectDerived: async () => null,
      inspectStoryboard: async () => null, inspectVideo: approval.inspect });
    const projected = await effects({ projectId: 7, actorUserId: 1,
      runId: parent.id });
    assert.equal(projected.videoEffects.length, 2);
    assert.equal(projected.videoEffects.find((entry) =>
      entry.operationId === "video-operation-1")?.approval?.status, "pending");
    assert.equal(projected.videoEffects.find((entry) =>
      entry.operationId === "video-operation-2")?.status, "denied");
    const approved = await approval.decide({ projectId: 7, actorUserId: 1,
      runId: child.id, approvalId: pending!.id,
      clientCommandId: "owner-video-approve",
      expectedVersion: pending!.runVersion, decision: "approve" });
    assert.equal(approved?.status, "approved");
    assert.equal((await db("o_agentVideoVendorRequest")).length, 0);
    assert.equal((await runtime.inspect({ runId: parent.id,
      projectId: 7, actorUserId: 1 }))?.status, "succeeded");
  } finally { await db.destroy(); }
});
