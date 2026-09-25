import assert from "node:assert/strict";
import test from "node:test";

import { authorizeLegacyProductionContext } from "../src/socket/legacyProductionContext";

const ownsProject = async (projectId: number, actorUserId: number) => projectId === 7 && actorUserId === 1;
const ownsScript = async (projectId: number, scriptId: number) => projectId === 7 && scriptId === 11;

test("Legacy production context accepts only the actor's matching Project and Script", async () => {
  assert.deepEqual(await authorizeLegacyProductionContext({
    actorUserId: 1, projectId: "7", scriptId: 11, isolationKey: "7:productionAgent:11",
  }, ownsProject, ownsScript), { projectId: 7, scriptId: 11, isolationKey: "7:productionAgent:11" });

  for (const input of [
    { actorUserId: 2, projectId: 7, scriptId: 11, isolationKey: "7:productionAgent:11" },
    { actorUserId: 1, projectId: 8, scriptId: 11, isolationKey: "8:productionAgent:11" },
    { actorUserId: 1, projectId: 7, scriptId: 12, isolationKey: "7:productionAgent:12" },
    { actorUserId: 1, projectId: 7, scriptId: 11, isolationKey: "7:productionAgent:12" },
    { actorUserId: 1, projectId: 7, scriptId: "../11", isolationKey: "7:productionAgent:../11" },
  ]) {
    assert.equal(await authorizeLegacyProductionContext(input, ownsProject, ownsScript), null);
  }
});

test("Unselected episode can connect but cannot impersonate a selected Script", async () => {
  assert.deepEqual(await authorizeLegacyProductionContext({
    actorUserId: 1, projectId: 7, scriptId: undefined, isolationKey: "7:productionAgent:undefined",
  }, ownsProject, ownsScript), { projectId: 7, scriptId: null, isolationKey: "7:productionAgent:undefined" });
  assert.equal(await authorizeLegacyProductionContext({
    actorUserId: 1, projectId: 7, scriptId: undefined, isolationKey: "7:productionAgent:11",
  }, ownsProject, ownsScript), null);
});
