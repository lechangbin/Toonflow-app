import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hashRuntimeSourceSet } from "../src/eval/runtimeCorpusCodeRevision";

test("T11 revision binds executable source content and newly added files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "toonflow-t11-source-"));
  try {
    await fs.mkdir(path.join(root, "runtime"));
    await fs.writeFile(path.join(root, "runtime", "agent.ts"), "version one");
    const first = await hashRuntimeSourceSet(root, ["runtime"]);
    assert.equal(first, await hashRuntimeSourceSet(root, ["runtime"]));
    await fs.writeFile(path.join(root, "runtime", "agent.ts"), "version two");
    const changed = await hashRuntimeSourceSet(root, ["runtime"]);
    assert.notEqual(changed, first);
    await fs.writeFile(path.join(root, "runtime", "tool.ts"), "new seam");
    assert.notEqual(await hashRuntimeSourceSet(root, ["runtime"]), changed);
    await assert.rejects(hashRuntimeSourceSet(root, ["../outside"]), /outside/u);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
