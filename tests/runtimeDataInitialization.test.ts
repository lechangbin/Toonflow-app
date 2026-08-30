import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { initializeRuntimeData } from "../src/server/runtimeData";

async function withTemporaryDataDirectories(
  run: (directories: { root: string; runtimeDir: string; seedDir: string }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "toonflow-runtime-data-"));
  const seedDir = path.join(root, "seed");
  const runtimeDir = path.join(root, "runtime");
  await mkdir(seedDir, { recursive: true });

  try {
    await run({ root, runtimeDir, seedDir });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("an empty runtime volume receives only versioned seed resources", async () => {
  await withTemporaryDataDirectories(async ({ runtimeDir, seedDir }) => {
    await mkdir(path.join(seedDir, "web"), { recursive: true });
    await mkdir(path.join(seedDir, "vendor"), { recursive: true });
    await mkdir(path.join(seedDir, "oss"), { recursive: true });
    await writeFile(path.join(seedDir, "version.txt"), "1.1.9\n");
    await writeFile(path.join(seedDir, "web", "index.html"), "<main>Toonflow</main>");
    await writeFile(path.join(seedDir, "vendor", "agnes.ts"), "export const vendor = {};\n");
    await writeFile(path.join(seedDir, "db2.sqlite"), "local database must not be seeded");
    await writeFile(path.join(seedDir, "oss", "private.png"), "private media must not be seeded");
    await writeFile(path.join(seedDir, ".env"), "SECRET=must-not-be-seeded\n");

    const result = await initializeRuntimeData({ runtimeDir, seedDir });

    assert.deepEqual(result, { status: "initialized", version: "1.1.9" });
    assert.equal(await readFile(path.join(runtimeDir, "web", "index.html"), "utf8"), "<main>Toonflow</main>");
    assert.equal(
      await readFile(path.join(runtimeDir, "vendor", "agnes.ts"), "utf8"),
      "export const vendor = {};\n",
    );
    await assert.rejects(readFile(path.join(runtimeDir, "db2.sqlite")), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(runtimeDir, "oss", "private.png")), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(runtimeDir, ".env")), { code: "ENOENT" });

    const marker = JSON.parse(await readFile(path.join(runtimeDir, ".toonflow-seed.json"), "utf8"));
    assert.deepEqual(marker, { version: "1.1.9" });
  });
});

test("an unmarked non-empty runtime volume fails before seed resources are merged", async () => {
  await withTemporaryDataDirectories(async ({ runtimeDir, seedDir }) => {
    await mkdir(runtimeDir, { recursive: true });
    await mkdir(path.join(seedDir, "web"), { recursive: true });
    await writeFile(path.join(seedDir, "version.txt"), "1.1.9\n");
    await writeFile(path.join(seedDir, "web", "index.html"), "new version");
    await writeFile(path.join(runtimeDir, "db2.sqlite"), "pre-existing data");

    await assert.rejects(
      initializeRuntimeData({ runtimeDir, seedDir }),
      /Runtime data directory is not empty and has no seed marker/,
    );
    await assert.rejects(readFile(path.join(runtimeDir, "web", "index.html")), { code: "ENOENT" });
  });
});

test("a restart with the same seed version never mutates initialized runtime data", async () => {
  await withTemporaryDataDirectories(async ({ runtimeDir, seedDir }) => {
    await mkdir(path.join(seedDir, "vendor"), { recursive: true });
    await mkdir(path.join(seedDir, "web"), { recursive: true });
    await writeFile(path.join(seedDir, "version.txt"), "1.1.9\n");
    await writeFile(path.join(seedDir, "vendor", "agnes.ts"), "versioned seed");
    await writeFile(path.join(seedDir, "web", "index.html"), "first Web build");

    await initializeRuntimeData({ runtimeDir, seedDir });
    await writeFile(path.join(runtimeDir, "vendor", "agnes.ts"), "user configuration");
    await writeFile(path.join(seedDir, "web", "index.html"), "upgraded Web build");
    await writeFile(path.join(runtimeDir, "web", "stale.js"), "stale asset");

    assert.deepEqual(await initializeRuntimeData({ runtimeDir, seedDir }), {
      status: "existing",
      version: "1.1.9",
    });
    assert.equal(await readFile(path.join(runtimeDir, "vendor", "agnes.ts"), "utf8"), "user configuration");
    assert.equal(await readFile(path.join(runtimeDir, "web", "index.html"), "utf8"), "first Web build");
    assert.equal(await readFile(path.join(runtimeDir, "web", "stale.js"), "utf8"), "stale asset");
  });
});

test("an older marked runtime volume fails instead of being silently migrated", async () => {
  await withTemporaryDataDirectories(async ({ runtimeDir, seedDir }) => {
    await mkdir(path.join(seedDir, "web"), { recursive: true });
    await mkdir(path.join(runtimeDir, "web"), { recursive: true });
    await writeFile(path.join(seedDir, "version.txt"), "1.1.9\n");
    await writeFile(path.join(seedDir, "web", "index.html"), "new release");
    await writeFile(path.join(runtimeDir, ".toonflow-seed.json"), `${JSON.stringify({ version: "1.1.8" })}\n`);
    await writeFile(path.join(runtimeDir, "web", "index.html"), "old release");

    await assert.rejects(
      initializeRuntimeData({ runtimeDir, seedDir }),
      /initialized from seed 1\.1\.8, but this image provides 1\.1\.9/,
    );
    assert.equal(await readFile(path.join(runtimeDir, "web", "index.html"), "utf8"), "old release");
  });
});
