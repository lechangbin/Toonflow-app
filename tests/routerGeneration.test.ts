import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import generateRouter from "../src/core";

test("router generation includes route modules and excludes colocated *Router helpers", async () => {
  const originalDirectory = process.cwd();
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "toonflow-router-"));
  try {
    await fs.mkdir(path.join(temporaryDirectory, "src", "routes", "feature"), { recursive: true });
    await fs.writeFile(path.join(temporaryDirectory, "src", "routes", "feature", "getThing.ts"), "export default {};\n");
    await fs.writeFile(
      path.join(temporaryDirectory, "src", "routes", "feature", "getThingRouter.ts"),
      "export function createRouter() { return {}; }\n",
    );
    process.chdir(temporaryDirectory);

    await generateRouter();
    const generated = await fs.readFile(path.join(temporaryDirectory, "src", "router.ts"), "utf8");
    assert.match(generated, /\.\/routes\/feature\/getThing/);
    assert.doesNotMatch(generated, /getThingRouter/);
  } finally {
    process.chdir(originalDirectory);
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
