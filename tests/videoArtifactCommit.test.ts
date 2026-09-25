import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import knexFactory from "knex";

import { AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
  canonicalCheckpointPayload, hashCheckpointPayload,
  type AgentRunCheckpointPayload } from "../src/agentRuntime/checkpoints";
import { VIDEO_GENERATION_TOOL_DEFINITION,
  toolDefinitionContractHash } from "../src/controlledTools/definitions";
import { createVideoApprovalScope } from "../src/controlledTools/videoApprovalScope";
import { createVideoArtifactRuntime } from "../src/controlledTools/videoArtifact";
import { createVideoArtifactCommitRuntime } from
  "../src/controlledTools/videoArtifactCommit";
import { freezeVideoGenerationProposal } from
  "../src/controlledTools/videoGenerationProposalContract";
import { VideoRequestLedgerConflictError } from
  "../src/controlledTools/videoRequestLedger";
import initDB from "../src/lib/initDB";
import { workOf } from "./databaseTestSupport";

const selection = { vendorId: "agnes", modelId: "model",
  capabilityId: "text-to-video" as const, inputs: [],
  output: { presetId: "720p", duration: 5,
    resolution: "720p", aspectRatio: "16:9" as const },
  audio: { generation: "native" as const, enabled: true } };
const payload = { scriptId: 11,
  item: { trackId: 31, promptRevisionId: 51, ...selection } };
const bytes = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d,
  0x6d, 0x70, 0x34, 0x32]);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  await initDB(db);
  await db("o_project").insert({ id: 7, userId: 1 });
  await db("o_script").insert({ id: 11, projectId: 7 });
  await db("o_videoTrack").insert({ id: 31, projectId: 7, scriptId: 11,
    state: "已完成", promptRevisionId: 51, duration: 5,
    vendorId: selection.vendorId, modelId: selection.modelId,
    capabilityId: selection.capabilityId, inputRefs: "[]",
    outputSelection: JSON.stringify(selection.output),
    audioSelection: JSON.stringify(selection.audio) });
  await db("o_promptRevision").insert({ id: 51, projectId: 7,
    videoTrackId: 31, status: "active", profileId: "agnes/text-v1",
    strategy: "custom", brief: "{}", draft: "{}",
    renderedPrompt: "A lantern sways", createdAt: 100 });
  const prepared = await freezeVideoGenerationProposal(db, 7, payload);
  const scopeBuilder = createVideoApprovalScope({
    prepare: async () => ({ payload: prepared.payload,
      payloadHash: prepared.payloadHash, targetStateHash: prepared.targetStateHash,
      commandHash: "c".repeat(64), preview: prepared.preview }),
    quote: async (target) => ({ ...target,
      estimatedMaxCostMicros: 250_000, currency: "USD",
      revision: 1, updatedAt: 100 }),
  });
  const scope = await scopeBuilder.prepare(7, payload);
  const scopeJson = JSON.stringify(scope);
  await db("o_agentRun").insert({ id: "run-7", projectId: 7, scriptId: 11,
    role: "productionAgent", scope: "approved-billable-video-v1",
    clientRequestId: "candidate-7", requestFingerprint: "fingerprint",
    input: JSON.stringify({ operationId: "operation-7", scopeHash: scope.scopeHash }),
    status: "waiting", waitingReason: "vendor-request-may-be-in-flight",
    allowedActions: '["inspect"]', version: 3, createdAt: 100, updatedAt: 100 });
  await db("o_agentRunStep").insert({ id: "step-7", runId: "run-7",
    ordinal: 1, kind: "tool", logicalTarget: "{}",
    promptFingerprint: "fingerprint", status: "running" });
  await db("o_agentRunAttempt").insert({ id: "attempt-7", runId: "run-7",
    stepId: "step-7", ordinal: 1, reason: "initial", status: "running",
    createdAt: 100 });
  await db("o_agentToolReceipt").insert({ id: "receipt-7", runId: "run-7",
    operationId: "operation-7", toolName: VIDEO_GENERATION_TOOL_DEFINITION.name,
    toolRevision: VIDEO_GENERATION_TOOL_DEFINITION.revision,
    inputHash: sha(scopeJson), status: "pending", createdAt: 100, updatedAt: 100 });
  await db("o_agentToolApproval").insert({ id: "approval-7", runId: "run-7",
    receiptId: "receipt-7", operationId: "operation-7",
    toolRevision: VIDEO_GENERATION_TOOL_DEFINITION.revision,
    contractHash: toolDefinitionContractHash(VIDEO_GENERATION_TOOL_DEFINITION),
    payloadJson: scopeJson, payloadHash: sha(scopeJson),
    targetStateHash: scope.targetStateHash,
    previewJson: JSON.stringify(scope.preview), status: "approved",
    expiresAt: 10_000, createdAt: 100 });
  await db("o_agentToolCall").insert({ id: "call-7", runId: "run-7",
    stepId: "step-7", attemptId: "attempt-7", receiptId: "receipt-7",
    approvalId: "approval-7", toolName: VIDEO_GENERATION_TOOL_DEFINITION.name,
    toolRevision: VIDEO_GENERATION_TOOL_DEFINITION.revision,
    inputHash: sha(scopeJson), status: "dispatch_recorded",
    createdAt: 100, updatedAt: 100 });
  await db("o_agentVideoVendorRequest").insert({ id: "request-row-7",
    runId: "run-7", toolCallId: "call-7", projectId: 7, trackId: 31,
    requestId: "request-7", scopeHash: scope.scopeHash,
    vendorId: selection.vendorId, modelId: selection.modelId,
    commandHash: scope.commandHash, estimatedMaxCostMicros: 250_000,
    currency: "USD", status: "dispatch_recorded", version: 1,
    createdAt: 100, updatedAt: 100 });
  const first: AgentRunCheckpointPayload = { schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
    kind: "run-created", runId: "run-7", stepId: "step-7", attemptId: "attempt-7",
    sequence: 1, runVersion: 1, lastCommittedStepId: null,
    predecessorCheckpointId: null, predecessorPayloadHash: null,
    requestFingerprint: "fingerprint" };
  const second: AgentRunCheckpointPayload = { schemaVersion: AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
    kind: "vendor-request-intent", runId: "run-7", stepId: "step-7",
    attemptId: "attempt-7", sequence: 2, runVersion: 3,
    lastCommittedStepId: null, predecessorCheckpointId: "checkpoint-1",
    predecessorPayloadHash: hashCheckpointPayload(first),
    requestId: "request-7", scopeHash: scope.scopeHash };
  for (const [id, item] of [["checkpoint-1", first], ["checkpoint-2", second]] as const) {
    await db("o_agentRunCheckpoint").insert({ id, runId: "run-7",
      stepId: "step-7", attemptId: "attempt-7", sequence: item.sequence,
      kind: item.kind, schemaVersion: item.schemaVersion,
      runVersion: item.runVersion, payload: canonicalCheckpointPayload(item),
      payloadHash: hashCheckpointPayload(item), createdAt: 100 });
  }
  const media = new Map<string, Buffer>();
  let next = 0;
  const artifact = createVideoArtifactRuntime({ work: workOf(db),
    now: () => 200, createId: () => `artifact-${++next}`,
    writeMedia: async (path, base64) => { media.set(path, Buffer.from(base64, "base64")); },
    readMedia: async (path) => {
      const value = media.get(path); if (!value) throw new Error("missing media");
      return value;
    } });
  const commit = createVideoArtifactCommitRuntime({ work: workOf(db),
    now: () => 300, createId: () => `commit-${++next}` });
  return { db, artifact, commit };
}

test("observed Video is adopted once with Task, Revision and durable Run evidence", async () => {
  const { db, artifact, commit } = await fixture();
  try {
    await artifact.observe("request-7", bytes.toString("base64"));
    const result = await commit.commit({ projectId: 7, actorUserId: 1,
      requestId: "request-7", expectedVersion: 4 });
    assert.equal(result.artifactHash, createHash("sha256").update(bytes).digest("hex"));
    assert.equal((await db("o_video")).length, 1);
    assert.equal((await db("o_generationTask")).length, 1);
    assert.equal((await db("o_productionAction")).length, 1);
    assert.equal((await db("o_artifactRevision")).length, 1);
    assert.equal((await db("o_agentRun").where({ id: "run-7" }).first()).status, "succeeded");
    assert.deepEqual(await commit.commit({ projectId: 7, actorUserId: 1,
      requestId: "request-7", expectedVersion: 4 }), result);
    assert.equal((await db("o_video")).length, 1);
  } finally { await db.destroy(); }
});

test("changed Prompt and canceled late media cannot be adopted", async () => {
  const { db, artifact, commit } = await fixture();
  try {
    await artifact.observe("request-7", bytes.toString("base64"));
    await db("o_promptRevision").where({ id: 51 })
      .update({ renderedPrompt: "changed" });
    await assert.rejects(commit.commit({ projectId: 7, actorUserId: 1,
      requestId: "request-7", expectedVersion: 4 }));
    assert.equal((await db("o_video")).length, 0);
    await db("o_agentRun").where({ id: "run-7" })
      .update({ status: "cancelled" });
    await assert.rejects(commit.commit({ projectId: 7, actorUserId: 1,
      requestId: "request-7", expectedVersion: 4 }),
    VideoRequestLedgerConflictError);
    assert.equal((await db("o_video")).length, 0);
  } finally { await db.destroy(); }
});

test("failed Revision insertion rolls back every Project adoption write", async () => {
  const { db, artifact, commit } = await fixture();
  try {
    await artifact.observe("request-7", bytes.toString("base64"));
    await db.raw(`CREATE TRIGGER reject_video_revision BEFORE INSERT ON o_artifactRevision
      BEGIN SELECT RAISE(ABORT, 'revision unavailable'); END`);
    await assert.rejects(commit.commit({ projectId: 7, actorUserId: 1,
      requestId: "request-7", expectedVersion: 4 }), /revision unavailable/);
    assert.equal((await db("o_video")).length, 0);
    assert.equal((await db("o_generationTask")).length, 0);
    assert.equal((await db("o_productionAction")).length, 0);
    assert.equal((await db("o_agentVideoArtifact").first()).status, "observed");
  } finally { await db.destroy(); }
});
