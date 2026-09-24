import assert from "node:assert/strict";
import test from "node:test";

import {
  freezeScriptWritePayload, scriptContentWriteInput,
  scriptContentWritePreview, scriptWorkspaceWriteInput,
  scriptWorkspaceWritePreview,
} from "../src/controlledTools/scriptWriteContract";
import {
  SCRIPT_CONTENT_WRITE_TOOL_DEFINITION,
  SCRIPT_WORKSPACE_WRITE_TOOL_DEFINITION,
  toolDefinitionContractHash,
} from "../src/controlledTools/definitions";

test("Script workspace write candidates are strict, bounded, and content-free in approval preview", () => {
  const frozen = freezeScriptWritePayload(scriptWorkspaceWriteInput,
    { key: "storySkeleton", content: "第一幕：主角启程" });
  const preview = scriptWorkspaceWritePreview({ payload: frozen.payload,
    payloadHash: frozen.payloadHash, targetStateHash: "target-v1" });
  assert.equal(preview.contentLength, frozen.payload.content.length);
  assert.equal(JSON.stringify(preview).includes("主角启程"), false);
  assert.equal(preview.payloadHash, frozen.payloadHash);
  assert.equal(freezeScriptWritePayload(scriptWorkspaceWriteInput,
    { key: "storySkeleton", content: "第一幕：主角启程" }).payloadHash, frozen.payloadHash);
  assert.throws(() => freezeScriptWritePayload(scriptWorkspaceWriteInput,
    { key: "script", content: "不可写" }));
  assert.throws(() => freezeScriptWritePayload(scriptWorkspaceWriteInput,
    { key: "storySkeleton", content: "超出边界", extra: true }));
  assert.throws(() => freezeScriptWritePayload(scriptWorkspaceWriteInput,
    { key: "storySkeleton", content: "x".repeat(32_001) }));
});

test("Script write Tool revisions freeze distinct capability and approval contracts", () => {
  const workspace = SCRIPT_WORKSPACE_WRITE_TOOL_DEFINITION;
  const script = SCRIPT_CONTENT_WRITE_TOOL_DEFINITION;
  assert.deepEqual(workspace.policy.capabilities, ["write:script-workspace"]);
  assert.deepEqual(script.policy.capabilities, ["write:script"]);
  assert.deepEqual(workspace.policy.scopes, ["approved-script-write-v1"]);
  assert.equal(workspace.policy.approval, "per-operation-exact-payload-and-target-state");
  assert.notEqual(toolDefinitionContractHash(workspace), toolDefinitionContractHash(script));
  assert.match(toolDefinitionContractHash(workspace), /^[a-f0-9]{64}$/);
});

test("Script content write candidates distinguish create and scoped update identities", () => {
  const created = freezeScriptWritePayload(scriptContentWriteInput,
    { effect: "create", name: "第一集", content: "第一场" });
  const updated = freezeScriptWritePayload(scriptContentWriteInput,
    { effect: "update", scriptId: 7, name: "第一集", content: "第一场" });
  assert.notEqual(created.payloadHash, updated.payloadHash);
  assert.equal(scriptContentWritePreview({ payload: created.payload,
    payloadHash: created.payloadHash, targetStateHash: "absent" }).scriptId, null);
  assert.equal(scriptContentWritePreview({ payload: updated.payload,
    payloadHash: updated.payloadHash, targetStateHash: "state-v1" }).scriptId, 7);
  assert.throws(() => freezeScriptWritePayload(scriptContentWriteInput,
    { effect: "update", scriptId: 0, name: "第一集", content: "第一场" }));
  assert.throws(() => freezeScriptWritePayload(scriptContentWriteInput,
    { effect: "create", scriptId: 7, name: "第一集", content: "第一场" }));
  assert.throws(() => freezeScriptWritePayload(scriptContentWriteInput,
    { effect: "create", name: "第一集", content: "x".repeat(100_001) }));
});
