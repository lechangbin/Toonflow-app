import assert from "node:assert/strict";
import test from "node:test";

import { createLegacyStopLifecycle } from "../src/socket/legacyStopLifecycle";

test("Legacy stop sends one server status event after abort and ignores repeats", () => {
  const lifecycle = createLegacyStopLifecycle();
  const controller = new AbortController();
  const events: string[] = [];
  lifecycle.start(controller, { stop: () => events.push("stop") });
  assert.equal(lifecycle.stop(), true);
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(events, ["stop"]);
  assert.equal(lifecycle.stop(), false);
  assert.deepEqual(events, ["stop"]);
});

test("Late finish of an old chat cannot clear the next active stop target", () => {
  const lifecycle = createLegacyStopLifecycle();
  const first = new AbortController();
  const second = new AbortController();
  const events: string[] = [];
  lifecycle.start(first, { stop: () => events.push("first") });
  lifecycle.start(second, { stop: () => events.push("second") });
  assert.equal(first.signal.aborted, true);
  lifecycle.finish(first);
  assert.equal(lifecycle.stop(), true);
  assert.equal(second.signal.aborted, true);
  assert.deepEqual(events, ["first", "second"]);
});
