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

test("A stopped legacy message fences existing and newly created content streams", () => {
  const events: Array<{ event: string; payload: unknown }> = [];
  const socket = { emit: (event: string, payload: unknown) => {
    events.push({ event, payload });
  } };
  const message = new MessageBuilder(socket as never, "message-3", "assistant");
  const text = message.text("before");
  const markdown = message.markdown("before");
  const thinking = message.thinking();
  const search = message.search();
  const toolCall = message.toolCall({ toolCallId: "tool-1", toolCallName: "read" });
  const reasoning = message.reasoning();
  message.stop();
  const stoppedAt = events.length;

  text.append("<think>late</think>tail").complete("late final").error();
  markdown.append("late").merge("late").complete("late").error();
  thinking.appendText("late").updateTitle("late").complete();
  search.addReference({} as never).addReferences([]).updateTitle("late").complete();
  toolCall.appendArgs("late").appendResult("late").setResult("late")
    .updateEventType("call" as never).complete();
  reasoning.addContent({} as never).complete();
  message.text("late").append("late");
  message.image({} as never).suggestion([]).activity("late", {});

  assert.equal(events.length, stoppedAt);
  assert.deepEqual(events.slice(-1).map(({ event, payload }) =>
    [event, (payload as { status?: string }).status]), [["message:update", "stop"]]);
});
