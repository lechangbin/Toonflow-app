import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";
import knexFactory from "knex";

import initDB from "../src/lib/initDB";
import { createProjectSkillGrantRuntime, resolveReadOnlyScriptSkillGrants } from "../src/skillRuntime/grants";
import { createSetReadNovelGrantRouter } from "../src/routes/agentRuns/setReadNovelGrant";
import { createSetReadScriptWorkspaceGrantRouter } from "../src/routes/agentRuns/setReadScriptWorkspaceGrant";
import { createSetReadScriptGrantRouter } from "../src/routes/agentRuns/setReadScriptGrant";

test("Project Skill grants are owner-only, deny by default, versioned, and revocable for existing Runs", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert([{ id: 7, userId: 1, name: "本项目" },
      { id: 9, userId: 2, name: "其他项目" }]);
    await db("o_agentRun").insert({ id: "grant-run", projectId: 7,
      role: "scriptAgent", scope: "read-only-project-guidance-v1",
      clientRequestId: "grant-test", requestFingerprint: "fingerprint",
      input: "{}", status: "queued", allowedActions: "[]", version: 1,
      createdAt: 100, updatedAt: 100, fence: 0 });
    const grant = createProjectSkillGrantRuntime({ work: async (operation) => operation(db),
      now: () => 200 });
    const resolve = () => db.transaction((tx) => resolveReadOnlyScriptSkillGrants(tx,
      { runId: "grant-run", projectId: 7, toolName: "get_novel_text" }));
    assert.deepEqual((await resolve()).projectGrants, []);
    const resolveWorkspace = () => db.transaction((tx) => resolveReadOnlyScriptSkillGrants(tx,
      { runId: "grant-run", projectId: 7, toolName: "get_script_workspace" }));
    assert.deepEqual((await resolveWorkspace()).projectGrants, [],
      "novel and workspace grants deny independently by default");
    const resolveScript = () => db.transaction((tx) => resolveReadOnlyScriptSkillGrants(tx,
      { runId: "grant-run", projectId: 7, toolName: "get_script_content" }));
    assert.deepEqual((await resolveScript()).projectGrants, []);
    await assert.rejects(grant.setReadNovel({ projectId: 7, actorUserId: 2,
      expectedVersion: 0, active: true }), /Project owner/);
    const enabled = await grant.setReadNovel({ projectId: 7, actorUserId: 1,
      expectedVersion: 0, active: true });
    assert.equal(enabled.version, 1);
    assert.deepEqual(await resolve(), { platformGrants: ["read:novel"],
      projectGrants: ["read:novel"], runGrants: ["read:novel"],
      roleGrants: ["read:novel"] });
    await assert.rejects(grant.setReadScriptWorkspace({ projectId: 7, actorUserId: 2,
      expectedVersion: 0, active: true }), /Project owner/);
    const workspace = await grant.setReadScriptWorkspace({ projectId: 7,
      actorUserId: 1, expectedVersion: 0, active: true });
    assert.equal(workspace.capability, "read:script-workspace");
    assert.deepEqual((await resolveWorkspace()).projectGrants, ["read:script-workspace"]);
    await grant.setReadScriptWorkspace({ projectId: 7, actorUserId: 1,
      expectedVersion: 1, active: false });
    assert.deepEqual((await resolveWorkspace()).projectGrants, []);
    assert.deepEqual((await resolve()).projectGrants, ["read:novel"],
      "revoking workspace access does not revoke novel access");
    await assert.rejects(grant.setReadScript({ projectId: 7, actorUserId: 2,
      expectedVersion: 0, active: true }), /Project owner/);
    await grant.setReadScript({ projectId: 7, actorUserId: 1,
      expectedVersion: 0, active: true });
    assert.deepEqual((await resolveScript()).projectGrants, ["read:script"]);
    assert.deepEqual((await resolveWorkspace()).projectGrants, [],
      "script content does not grant workspace access");
    await assert.rejects(grant.setReadNovel({ projectId: 7, actorUserId: 1,
      expectedVersion: 0, active: false }), /version conflict/);
    const revoked = await grant.setReadNovel({ projectId: 7, actorUserId: 1,
      expectedVersion: 1, active: false });
    assert.equal(revoked.version, 2);
    assert.deepEqual((await resolve()).projectGrants, []);
    await assert.rejects(db.transaction((tx) => resolveReadOnlyScriptSkillGrants(tx,
      { runId: "grant-run", projectId: 9, toolName: "get_novel_text" })), /outside Run Project scope/);
  } finally { await db.destroy(); }
});

test("Script content grant route takes actor identity from authentication middleware", async () => {
  let received: unknown;
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: 5 };
    next();
  }, createSetReadScriptGrantRouter({ setReadScript: async (input) => {
    received = input;
    return { projectId: input.projectId, capability: "read:script" as const,
      state: "active", version: 1, updatedAt: 100 };
  } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: 7, expectedVersion: 0,
        active: true, actorUserId: 99 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received, { projectId: 7, expectedVersion: 0,
      active: true, actorUserId: 5 });
  } finally { server.close(); await once(server, "close"); }
});

test("Script workspace grant route takes actor identity from authentication middleware", async () => {
  let received: unknown;
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: 5 };
    next();
  }, createSetReadScriptWorkspaceGrantRouter({ setReadScriptWorkspace: async (input) => {
    received = input;
    return { projectId: input.projectId, capability: "read:script-workspace" as const,
      state: "active", version: 1, updatedAt: 100 };
  } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: 7, expectedVersion: 0,
        active: true, actorUserId: 99 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received, { projectId: 7, expectedVersion: 0,
      active: true, actorUserId: 5 });
  } finally { server.close(); await once(server, "close"); }
});

test("Project grant route takes actor identity from authentication middleware, not the body", async () => {
  let received: unknown;
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: 5 };
    next();
  }, createSetReadNovelGrantRouter({ setReadNovel: async (input) => {
    received = input;
    return { projectId: input.projectId, capability: "read:novel" as const,
      state: "active", version: 1, updatedAt: 100 };
  } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: 7, expectedVersion: 0,
        active: true, actorUserId: 99 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received, { projectId: 7, expectedVersion: 0,
      active: true, actorUserId: 5 });
  } finally { server.close(); await once(server, "close"); }
});
