import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";
import knexFactory from "knex";

import initDB from "../src/lib/initDB";
import { createSetReadProductionWorkspaceGrantRouter } from
  "../src/routes/agentRuns/setReadProductionWorkspaceGrant";
import { createSetProposeDerivedAssetGrantRouter } from
  "../src/routes/agentRuns/setProposeDerivedAssetGrant";
import { createSetProposeStoryboardGrantRouter } from
  "../src/routes/agentRuns/setProposeStoryboardGrant";
import { createSetProposeVideoGrantRouter } from
  "../src/routes/agentRuns/setProposeVideoGrant";
import { createGetProductionGrantsRouter } from
  "../src/routes/agentRuns/getProductionGrants";
import { createProjectSkillGrantRuntime, resolveProductionImageProposalGrants,
  resolveProductionDerivedAssetProposalGrants, resolveProductionSkillGrants,
  resolveProductionStoryboardProposalGrants,
  resolveProductionVideoProposalGrants,
  resolveReadOnlyScriptSkillGrants } from "../src/skillRuntime/grants";

test("Production read grant is owner-only, revocable and separate from Script", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    await db("o_project").insert({ id: 7, userId: 1, name: "生产项目" });
    await db("o_agentRun").insert({ id: "production-grant-run", projectId: 7,
      role: "productionAgent", scope: "production-harness-v1",
      clientRequestId: "production-grant", requestFingerprint: "fingerprint",
      input: "{}", status: "queued", allowedActions: "[]", version: 1,
      createdAt: 100, updatedAt: 100, fence: 0 });
    const grants = createProjectSkillGrantRuntime({
      work: async (operation) => operation(db), now: () => 200 });
    assert.deepEqual(await grants.inspectProduction(7, 1), {
      workspace: { active: false, version: 0 },
      imageProposal: { active: false, version: 0 },
      derivedProposal: { active: false, version: 0 },
      storyboardProposal: { active: false, version: 0 },
      videoProposal: { active: false, version: 0 },
    });
    await assert.rejects(grants.inspectProduction(7, 2), /Project owner/);
    const resolve = () => db.transaction((tx) => resolveProductionSkillGrants(tx,
      { runId: "production-grant-run", projectId: 7,
        toolName: "get_production_workspace_text" }));
    assert.deepEqual((await resolve()).projectGrants, []);
    const imageProposalGrants = () => db.transaction((tx) =>
      resolveProductionImageProposalGrants(tx, { runId: "production-grant-run",
        projectId: 7 }));
    const derivedProposalGrants = () => db.transaction((tx) =>
      resolveProductionDerivedAssetProposalGrants(tx, { runId: "production-grant-run",
        projectId: 7 }));
    const storyboardProposalGrants = () => db.transaction((tx) =>
      resolveProductionStoryboardProposalGrants(tx, { runId: "production-grant-run",
        projectId: 7 }));
    const videoProposalGrants = () => db.transaction((tx) =>
      resolveProductionVideoProposalGrants(tx, { runId: "production-grant-run",
        projectId: 7 }));
    assert.deepEqual((await imageProposalGrants()).projectGrants, []);
    assert.deepEqual((await derivedProposalGrants()).projectGrants, []);
    assert.deepEqual((await storyboardProposalGrants()).projectGrants, []);
    assert.deepEqual((await videoProposalGrants()).projectGrants, []);
    await assert.rejects(grants.setReadProductionWorkspace({ projectId: 7,
      actorUserId: 2, expectedVersion: 0, active: true }), /Project owner/);
    const enabled = await grants.setReadProductionWorkspace({ projectId: 7,
      actorUserId: 1, expectedVersion: 0, active: true });
    assert.equal(enabled.capability, "read:production-workspace");
    assert.deepEqual(await resolve(), {
      platformGrants: ["read:production-workspace"],
      projectGrants: ["read:production-workspace"],
      runGrants: ["read:production-workspace"],
      roleGrants: ["read:production-workspace"],
    });
    await assert.rejects(db.transaction((tx) => resolveReadOnlyScriptSkillGrants(tx,
      { runId: "production-grant-run", projectId: 7,
        toolName: "get_production_workspace_text" })), /cannot use Script/);
    await assert.rejects(grants.setReadProductionWorkspace({ projectId: 7,
      actorUserId: 1, expectedVersion: 0, active: false }), /version conflict/);
    await grants.setReadProductionWorkspace({ projectId: 7,
      actorUserId: 1, expectedVersion: 1, active: false });
    assert.deepEqual((await resolve()).projectGrants, []);
    await assert.rejects(grants.setProposeBillableImage({ projectId: 7,
      actorUserId: 2, expectedVersion: 0, active: true }), /Project owner/);
    await grants.setProposeBillableImage({ projectId: 7,
      actorUserId: 1, expectedVersion: 0, active: true });
    assert.deepEqual((await imageProposalGrants()).projectGrants,
      ["propose:billable-image"]);
    assert.deepEqual((await resolve()).projectGrants, [],
      "image proposal grant does not restore workspace read");
    await grants.setProposeBillableImage({ projectId: 7,
      actorUserId: 1, expectedVersion: 1, active: false });
    assert.deepEqual((await imageProposalGrants()).projectGrants, []);
    await assert.rejects(grants.setProposeDerivedAsset({ projectId: 7,
      actorUserId: 2, expectedVersion: 0, active: true }), /Project owner/);
    await grants.setProposeDerivedAsset({ projectId: 7,
      actorUserId: 1, expectedVersion: 0, active: true });
    assert.deepEqual((await derivedProposalGrants()).projectGrants,
      ["propose:derived-asset"]);
    assert.deepEqual((await imageProposalGrants()).projectGrants, [],
      "derived Asset proposal grant cannot restore billable image proposal");
    await grants.setProposeDerivedAsset({ projectId: 7,
      actorUserId: 1, expectedVersion: 1, active: false });
    assert.deepEqual((await derivedProposalGrants()).projectGrants, []);
    await assert.rejects(grants.setProposeStoryboard({ projectId: 7,
      actorUserId: 2, expectedVersion: 0, active: true }), /Project owner/);
    await grants.setProposeStoryboard({ projectId: 7,
      actorUserId: 1, expectedVersion: 0, active: true });
    assert.deepEqual((await storyboardProposalGrants()).projectGrants,
      ["propose:storyboard"]);
    assert.deepEqual((await derivedProposalGrants()).projectGrants, [],
      "Storyboard proposal grant cannot restore derived Asset proposal");
    await grants.setProposeStoryboard({ projectId: 7,
      actorUserId: 1, expectedVersion: 1, active: false });
    assert.deepEqual((await storyboardProposalGrants()).projectGrants, []);
    await assert.rejects(grants.setProposeVideo({ projectId: 7,
      actorUserId: 2, expectedVersion: 0, active: true }), /Project owner/);
    await grants.setProposeVideo({ projectId: 7,
      actorUserId: 1, expectedVersion: 0, active: true });
    assert.deepEqual((await videoProposalGrants()).projectGrants,
      ["propose:track-video"]);
    assert.deepEqual((await imageProposalGrants()).projectGrants, [],
      "Video proposal grant cannot revive image proposal");
    await assert.rejects(grants.setProposeVideo({ projectId: 7,
      actorUserId: 1, expectedVersion: 0, active: false }), /version conflict/);
    await grants.setProposeVideo({ projectId: 7,
      actorUserId: 1, expectedVersion: 1, active: false });
    assert.deepEqual((await videoProposalGrants()).projectGrants, []);
    assert.deepEqual(await grants.inspectProduction(7, 1), {
      workspace: { active: false, version: 2 },
      imageProposal: { active: false, version: 2 },
      derivedProposal: { active: false, version: 2 },
      storyboardProposal: { active: false, version: 2 },
      videoProposal: { active: false, version: 2 },
    });
  } finally { await db.destroy(); }
});

test("Production grant snapshot HTTP reads only the authenticated Owner", async () => {
  let received: unknown;
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: 5 };
    next();
  }, createGetProductionGrantsRouter({ inspectProduction: async (...input) => {
    received = input;
    return { workspace: { active: false, version: 0 },
      imageProposal: { active: false, version: 0 },
      derivedProposal: { active: false, version: 0 },
      storyboardProposal: { active: false, version: 0 },
      videoProposal: { active: false, version: 0 } };
  } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: 7, actorUserId: 99 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received, [7, 5]);
  } finally { server.close(); await once(server, "close"); }
});

test("Derived Asset proposal grant HTTP takes authenticated actor", async () => {
  let received: unknown;
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: 5 };
    next();
  }, createSetProposeDerivedAssetGrantRouter({ setProposeDerivedAsset: async (input) => {
    received = input;
    return { projectId: input.projectId, capability: "propose:derived-asset" as const,
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

test("Storyboard proposal grant HTTP takes authenticated actor", async () => {
  let received: unknown;
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: 5 };
    next();
  }, createSetProposeStoryboardGrantRouter({ setProposeStoryboard: async (input) => {
    received = input;
    return { projectId: input.projectId, capability: "propose:storyboard" as const,
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

test("Video proposal grant HTTP takes authenticated actor", async () => {
  let received: unknown;
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: 5 };
    next();
  }, createSetProposeVideoGrantRouter({ setProposeVideo: async (input) => {
    received = input;
    return { projectId: input.projectId, capability: "propose:track-video" as const,
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

test("Production grant HTTP takes actor from authentication middleware", async () => {
  let received: unknown;
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: 5 };
    next();
  }, createSetReadProductionWorkspaceGrantRouter({ setReadProductionWorkspace: async (input) => {
    received = input;
    return { projectId: input.projectId, capability: "read:production-workspace" as const,
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
