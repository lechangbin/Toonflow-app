import assert from "node:assert/strict";
import test from "node:test";

import { createLegacyProductionContextGate } from "../src/socket/legacyProductionContextGate";

const first = { projectId: 7, scriptId: 11, isolationKey: "7:productionAgent:11" };
const second = { projectId: 7, scriptId: 12, isolationKey: "7:productionAgent:12" };

test("A pending or failed context switch cannot launch a chat under the old Script", () => {
  const gate = createLegacyProductionContextGate(first);
  assert.deepEqual(gate.chatContext(), first);
  const ticket = gate.begin();
  assert.equal(gate.chatContext(), null);
  assert.equal(gate.commit(ticket, null), false);
  assert.equal(gate.chatContext(), null);
  const retry = gate.begin();
  assert.equal(gate.commit(retry, second), true);
  assert.deepEqual(gate.chatContext(), second);
});

test("Late validation and disconnect cannot restore stale Production context", () => {
  const gate = createLegacyProductionContextGate(first);
  const old = gate.begin();
  const latest = gate.begin();
  assert.equal(gate.commit(old, first), false);
  assert.equal(gate.chatContext(), null);
  assert.equal(gate.commit(latest, second), true);
  gate.close();
  assert.equal(gate.chatContext(), null);
  assert.equal(gate.commit(latest, first), false);
});
