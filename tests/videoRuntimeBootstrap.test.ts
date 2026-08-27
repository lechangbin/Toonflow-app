import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { validateVideoRuntimeData } from "../src/video/bootstrap";

test("validates the complete retained Vendor and Prompt Profile registry", () => {
  const result = validateVideoRuntimeData(path.join(process.cwd(), "data"));
  assert.deepEqual(result.vendorIds.sort(), ["agnes", "minimax", "volcengine", "volcengineSd2"]);
  assert.equal(result.videoModelCount, 8);
  assert.equal(result.promptProfileCount, 8);
});
