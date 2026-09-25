import assert from "node:assert/strict";
import test from "node:test";

import { MessageBuilder } from "../src/socket/resTool";

test("A stopped legacy message cannot be completed or errored by a late callback", () => {
  const events: Array<{ event: string; payload: { status?: string } }> = [];
  const socket = { emit: (event: string, payload: { status?: string }) => {
    events.push({ event, payload });
  } };
  const message = new MessageBuilder(socket as never, "message-1", "assistant");

  message.stop();
  message.complete();
  message.error("late error");
  message.updateStatus("complete");
  message.stop();

  assert.deepEqual(events.map(({ event, payload }) => [event, payload.status]), [
    ["message:update", "stop"],
  ]);
});

test("A non-stopped legacy message can still complete", () => {
  const statuses: string[] = [];
  const socket = { emit: (_event: string, payload: { status?: string }) => {
    if (payload.status) statuses.push(payload.status);
  } };
  const message = new MessageBuilder(socket as never, "message-2", "assistant");
  message.complete();
  assert.deepEqual(statuses, ["complete"]);
});
