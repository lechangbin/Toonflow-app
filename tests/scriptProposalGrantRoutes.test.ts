import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";

import type { createProjectSkillGrantRuntime } from "../src/skillRuntime/grants";
import { createSetScriptProposalGrantRouter } from
  "../src/routes/agentRuns/setScriptProposalGrant";
import { createGetScriptProposalGrantsRouter } from
  "../src/routes/agentRuns/getScriptProposalGrants";

test("Script proposal grant HTTP derives Owner from authenticated request", async () => {
  const calls: unknown[] = [];
  const grants = {
    inspectScriptProposals: async (...args: unknown[]) => {
      calls.push(["inspect", args]);
      return { workspace: { active: false, version: 0 },
        script: { active: false, version: 0 } };
    },
    setProposeScriptWorkspace: async (input: unknown) => {
      calls.push(["workspace", input]); return { capability: "propose:script-workspace" };
    },
    setProposeScript: async (input: unknown) => {
      calls.push(["script", input]); return { capability: "propose:script" };
    },
  } as unknown as ReturnType<typeof createProjectSkillGrantRuntime>;
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: 5 };
    next();
  });
  app.use("/get", createGetScriptProposalGrantsRouter(grants));
  app.use("/set", createSetScriptProposalGrantRouter(grants));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const inspection = await fetch(`http://127.0.0.1:${address.port}/get`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: 7, actorUserId: 99 }),
    });
    assert.equal(inspection.status, 200);
    for (const kind of ["workspace", "script"]) {
      const grantResponse: Response = await fetch(`http://127.0.0.1:${address.port}/set`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: 7, kind, expectedVersion: 0,
          active: true, actorUserId: 99 }),
      });
      assert.equal(grantResponse.status, 200);
    }
    assert.deepEqual(calls, [
      ["inspect", [7, 5]],
      ["workspace", { projectId: 7, actorUserId: 5,
        expectedVersion: 0, active: true }],
      ["script", { projectId: 7, actorUserId: 5,
        expectedVersion: 0, active: true }],
    ]);
  } finally { server.close(); await once(server, "close"); }
});
