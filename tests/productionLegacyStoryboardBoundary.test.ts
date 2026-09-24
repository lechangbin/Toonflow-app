import assert from "node:assert/strict";
import test from "node:test";

import useProductionAgentTools, { waitLegacyStoryboardAck } from
  "../src/agents/productionAgent/tools";

function storyboardTool(reply: unknown) {
  let callbackCalled = false;
  const thinking = { appendText: () => thinking, updateTitle: () => thinking,
    complete: () => thinking };
  const tools = useProductionAgentTools({
    resTool: { data: { projectId: 7, scriptId: 11 },
      socket: { emit(event: string, _payload: unknown, callback: (value: unknown) => void) {
        assert.equal(event, "addStoryboard");
        callbackCalled = true;
        callback(reply);
      } } },
    msg: { thinking: () => thinking },
    toolsNames: ["add_flowData_storyboard"],
  } as never);
  return { execute: (tools.add_flowData_storyboard as unknown as {
    execute: (payload: unknown) => Promise<unknown> }).execute,
  acknowledged: () => callbackCalled };
}

const input = { videoDesc: "角色走入庭院", prompt: null, track: "main",
  duration: 4, associateAssetsIds: [21], shouldGenerateImage: "false" };

test("legacy storyboard compatibility Tool waits for frontend acknowledgement", async () => {
  const tool = storyboardTool({ success: true, storyboardId: 51 });
  assert.deepEqual(await tool.execute(input), { success: true, storyboardId: 51 });
  assert.equal(tool.acknowledged(), true);
});

test("legacy storyboard callback error is ambiguous, never a success claim", async () => {
  const tool = storyboardTool({ error: "write failed" });
  assert.match(String(await tool.execute(input)), /结果不确定/);
  assert.equal(tool.acknowledged(), true);
});

test("legacy storyboard success-false acknowledgement is not a success claim", async () => {
  const tool = storyboardTool({ success: false, message: "database write failed" });
  assert.match(String(await tool.execute(input)), /结果不确定/);
  assert.equal(tool.acknowledged(), true);
});

test("legacy storyboard unstructured acknowledgement is not a success claim", async () => {
  const tool = storyboardTool({ storyboardId: 51 });
  assert.match(String(await tool.execute(input)), /结果不确定/);
  assert.equal(tool.acknowledged(), true);
});

test("missing legacy browser acknowledgement times out as unknown without replay", async () => {
  let calls = 0;
  let lateCallback: ((response: unknown) => void) | undefined;
  await assert.rejects(waitLegacyStoryboardAck((_payload, callback) => {
    calls++;
    lateCallback = callback;
  }, input, 5), /effect unknown/);
  lateCallback?.({ success: true, storyboardId: 51 });
  assert.equal(calls, 1, "timeout and late callback must never re-emit the write");
});
