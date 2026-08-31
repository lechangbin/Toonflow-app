import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory from "knex";

import fixDB from "../src/lib/fixDB";
import initDB from "../src/lib/initDB";
import rawVendorManifest from "../src/lib/vendor.json";
import {
  BUILT_IN_VENDOR_REGISTRY,
  builtInVendorIds,
  createVendorRegistry,
  defaultEnabledVendorIds,
  isBuiltInVendor,
  isReleasedBuiltInVendor,
  releasedVendorIds,
  releasedVendorSourceFileNames,
  unreleasedBuiltInVendorIds,
  vendorRegistry,
} from "../src/lib/vendorRegistry";
import {
  readReleasedVendorSources,
  validateConfiguredVideoRuntimeData,
  validateReleaseBuildVendorData,
} from "../src/video/bootstrap";

const vendorManifest = rawVendorManifest as Record<string, string>;
const releaseDataRoot = path.join(process.cwd(), "data");
const releaseVendorDir = path.join(releaseDataRoot, "vendor");

/**
 * A custom Vendor program. It is deliberately not a registry entry and uses the
 * same CommonJS export shape as the real programs under `data/vendor/`.
 */
const CUSTOM_VENDOR_ID = "studioCustom";
const customVendorSource = `const vendor = {
  id: "${CUSTOM_VENDOR_ID}",
  name: "Studio Custom",
  version: "1.0.0",
  author: "Studio",
  inputValues: {},
  models: [{ name: "Custom Text", modelName: "custom-text", type: "text", think: false }],
};

const textRequest = () => "custom";

exports.vendor = vendor;
exports.textRequest = textRequest;

export {};
`;

function sorted(values: string[]): string[] {
  return values.slice().sort();
}

function createTemporaryDataRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-vendor-registry-"));
  fs.cpSync(releaseVendorDir, path.join(root, "vendor"), { recursive: true });
  fs.cpSync(path.join(releaseDataRoot, "promptProfiles"), path.join(root, "promptProfiles"), { recursive: true });
  return root;
}

function createTemporaryDatabase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-vendor-registry-db-"));
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(root, "db.sqlite") },
    useNullAsDefault: true,
  });
  return { root, knex };
}

/** Mirrors application readiness: a fresh schema before any repair. */
async function prepareTemporaryDatabase(knex: ReturnType<typeof knexFactory>) {
  await knex.raw("PRAGMA foreign_keys = OFF");
  // Avoid initializing unrelated embedding fixtures; these tests exercise Vendor ownership.
  await knex.schema.createTable("o_skillList", (table) => table.text("id").primary());
  await initDB(knex);
}

async function configuredVendorRows(knex: ReturnType<typeof knexFactory>): Promise<string[]> {
  return (await knex("o_vendorConfig").select("id")).map((row: { id: string }) => row.id);
}

function removeTemporaryDirectory(root: string) {
  fs.rmSync(root, { recursive: true, force: true });
}

test("every release-included built-in Vendor is declared once and backed by a real adapter source", () => {
  const allIds = builtInVendorIds();
  assert.equal(new Set(allIds).size, allIds.length, "the registry declares one Vendor id twice");
  assert.equal(
    new Set(releasedVendorIds()).size,
    releasedVendorIds().length,
    "the registry releases one Vendor id twice",
  );
  assert.equal(
    new Set(unreleasedBuiltInVendorIds()).size,
    unreleasedBuiltInVendorIds().length,
    "the registry retires one Vendor id twice",
  );

  // The released set is exactly the set of real Vendor programs shipped in data/vendor.
  const realSourceFiles = fs
    .readdirSync(releaseVendorDir)
    .filter((fileName) => fileName.endsWith(".ts"))
    .sort();
  assert.deepEqual(sorted(releasedVendorSourceFileNames()), realSourceFiles);

  for (const id of releasedVendorIds()) {
    assert.equal(isBuiltInVendor(id), true, `${id} must be a built-in Vendor`);
    assert.equal(isReleasedBuiltInVendor(id), true, `${id} must be released`);
    assert.equal(unreleasedBuiltInVendorIds().includes(id), false);
  }
  for (const id of unreleasedBuiltInVendorIds()) {
    assert.equal(isBuiltInVendor(id), true, `${id} must remain a declared built-in Vendor`);
    assert.equal(isReleasedBuiltInVendor(id), false, `${id} must not be released`);
  }
});

test("a fresh database seeds one Vendor row per released built-in with the registry default-enable policy", async () => {
  const { root, knex } = createTemporaryDatabase();

  try {
    await prepareTemporaryDatabase(knex);

    const rows = await knex("o_vendorConfig").select("id", "enable");
    const expected = vendorRegistry
      .releasedVendorRegistrations()
      .map(({ id, defaultEnabled }) => ({ id, enable: defaultEnabled ? 1 : 0 }));

    assert.deepEqual(
      rows.slice().sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)),
      expected.slice().sort((a, b) => a.id.localeCompare(b.id)),
    );
    assert.deepEqual(sorted(await configuredVendorRows(knex)), sorted(releasedVendorIds()));
  } finally {
    await knex.destroy();
    removeTemporaryDirectory(root);
  }
});

test("repair removes every unreleased built-in Vendor and preserves custom Vendors", async () => {
  const dataRoot = createTemporaryDataRoot();
  const { root, knex } = createTemporaryDatabase();
  fs.writeFileSync(path.join(dataRoot, "vendor", `${CUSTOM_VENDOR_ID}.ts`), customVendorSource);

  try {
    await prepareTemporaryDatabase(knex);
    await knex("o_vendorConfig").insert(
      unreleasedBuiltInVendorIds().map((id) => ({ id, inputValues: "{}", models: "[]", enable: 0 })),
    );
    await knex("o_vendorConfig").insert({
      id: CUSTOM_VENDOR_ID,
      inputValues: "{}",
      models: "[]",
      enable: 1,
    });
    for (const id of unreleasedBuiltInVendorIds()) {
      fs.writeFileSync(
        path.join(dataRoot, "vendor", `${id}.ts`),
        `const vendor = { id: "${id}", inputValues: {}, models: [] };\nexports.vendor = vendor;\n`,
      );
    }

    await fixDB(knex, dataRoot);

    const remaining = await configuredVendorRows(knex);
    for (const id of unreleasedBuiltInVendorIds()) {
      assert.equal(remaining.includes(id), false, `repair must remove the retired built-in ${id}`);
      assert.equal(fs.existsSync(path.join(dataRoot, "vendor", `${id}.ts`)), false, `repair must delete ${id}.ts`);
    }
    assert.ok(remaining.includes(CUSTOM_VENDOR_ID), "repair must preserve a custom Vendor");
    assert.deepEqual(sorted(remaining), sorted([...releasedVendorIds(), CUSTOM_VENDOR_ID]));
    assert.equal(
      fs.readFileSync(path.join(dataRoot, "vendor", `${CUSTOM_VENDOR_ID}.ts`), "utf8"),
      customVendorSource,
      "repair must not rewrite a custom Vendor source",
    );
  } finally {
    await knex.destroy();
    removeTemporaryDirectory(root);
    removeTemporaryDirectory(dataRoot);
  }
});

test("repair restores every released built-in Vendor declared by the registry", async () => {
  const dataRoot = createTemporaryDataRoot();
  const { root, knex } = createTemporaryDatabase();

  try {
    await prepareTemporaryDatabase(knex);
    // Simulate an installation that lost every released built-in Vendor.
    for (const id of releasedVendorIds()) {
      await knex("o_vendorConfig").where("id", id).delete();
      fs.rmSync(path.join(dataRoot, "vendor", `${id}.ts`), { force: true });
    }
    assert.deepEqual(await configuredVendorRows(knex), []);

    await fixDB(knex, dataRoot);

    assert.deepEqual(sorted(await configuredVendorRows(knex)), sorted(releasedVendorIds()));
    for (const id of releasedVendorIds()) {
      assert.equal(
        fs.readFileSync(path.join(dataRoot, "vendor", `${id}.ts`), "utf8"),
        vendorManifest[`${id}.ts`],
        `repair must restore ${id}.ts from the generated manifest`,
      );
    }
  } finally {
    await knex.destroy();
    removeTemporaryDirectory(root);
    removeTemporaryDirectory(dataRoot);
  }
});

test("startup validation covers every released built-in Vendor and accepts custom Vendors", async () => {
  const dataRoot = createTemporaryDataRoot();
  fs.writeFileSync(path.join(dataRoot, "vendor", `${CUSTOM_VENDOR_ID}.ts`), customVendorSource);
  const db = knexFactory({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });
  await db.schema.createTable("o_vendorConfig", (table) => {
    table.string("id").primary();
    table.text("inputValues");
    table.text("models");
  });
  await db("o_vendorConfig").insert(
    [...releasedVendorIds(), CUSTOM_VENDOR_ID].map((id) => ({ id, inputValues: "{}", models: "[]" })),
  );

  try {
    const result = await validateConfiguredVideoRuntimeData(db, dataRoot);
    assert.deepEqual(sorted(result.vendorIds), sorted([...releasedVendorIds(), CUSTOM_VENDOR_ID]));
    assert.equal(isBuiltInVendor(CUSTOM_VENDOR_ID), false, "a custom Vendor is never a registry entry");

    // Removing any released built-in source must stop startup, driven by the registry alone.
    for (const id of releasedVendorIds()) {
      const sourcePath = path.join(dataRoot, "vendor", `${id}.ts`);
      const hiddenPath = `${sourcePath}.hidden`;
      fs.renameSync(sourcePath, hiddenPath);
      try {
        await assert.rejects(validateConfiguredVideoRuntimeData(db, dataRoot), /Vendor Registry 缺少内置配置/);
      } finally {
        fs.renameSync(hiddenPath, sourcePath);
      }
    }
  } finally {
    await db.destroy();
    removeTemporaryDirectory(dataRoot);
  }
});

test("release build validation and the generated manifest consume the registry", () => {
  const validation = validateReleaseBuildVendorData(releaseDataRoot);
  assert.deepEqual(sorted(validation.vendorIds), sorted(releasedVendorIds()));

  assert.deepEqual(sorted(Object.keys(vendorManifest)), sorted(releasedVendorSourceFileNames()));
  const releasedSources = readReleasedVendorSources(releaseVendorDir);
  assert.deepEqual(releasedSources, vendorManifest);
  for (const fileName of releasedVendorSourceFileNames()) {
    assert.equal(
      vendorManifest[fileName],
      releasedSources[fileName],
      `the manifest must carry the real ${fileName} program`,
    );
  }

  const dataRoot = createTemporaryDataRoot();
  try {
    for (const id of releasedVendorIds()) {
      const sourcePath = path.join(dataRoot, "vendor", `${id}.ts`);
      fs.rmSync(sourcePath, { force: true });
      assert.throws(() => validateReleaseBuildVendorData(dataRoot), /Vendor Registry 缺少内置配置/);
      fs.writeFileSync(sourcePath, vendorManifest[`${id}.ts`]);
    }
  } finally {
    removeTemporaryDirectory(dataRoot);
  }
});

test("one registry change updates fresh defaults, repair scope, startup, build, and manifest together", () => {
  const restoredBuiltInId = unreleasedBuiltInVendorIds()[0];
  const addedBuiltInId = "studioBuiltIn";

  // Restoring one retired built-in removes it from the repair deletion set and
  // adds it to release inclusion, fresh defaults, and every source list.
  const restored = createVendorRegistry(
    BUILT_IN_VENDOR_REGISTRY.map((registration) =>
      registration.id === restoredBuiltInId ? { ...registration, released: true } : registration,
    ),
  );
  assert.equal(restored.unreleasedBuiltInVendorIds().includes(restoredBuiltInId), false);
  assert.ok(restored.releasedVendorIds().includes(restoredBuiltInId));
  assert.ok(restored.releasedVendorSourceFileNames().includes(`${restoredBuiltInId}.ts`));
  assert.ok(restored.releasedVendorRegistrations().some(({ id }) => id === restoredBuiltInId));

  // Adding one built-in updates every consuming read from the single declaration.
  const added = createVendorRegistry([
    ...BUILT_IN_VENDOR_REGISTRY,
    { id: addedBuiltInId, released: true, defaultEnabled: true },
  ]);
  assert.deepEqual(added.releasedVendorIds(), [...releasedVendorIds(), addedBuiltInId]);
  assert.deepEqual(added.releasedVendorSourceFileNames(), [
    ...releasedVendorSourceFileNames(),
    `${addedBuiltInId}.ts`,
  ]);
  assert.deepEqual(added.defaultEnabledVendorIds(), [...defaultEnabledVendorIds(), addedBuiltInId]);
  assert.deepEqual(added.releasedVendorRegistrations().filter((r) => r.defaultEnabled).map((r) => r.id), [
    addedBuiltInId,
  ]);

  // The repair deletion set is untouched by an addition, so existing custom data survives.
  assert.deepEqual(added.unreleasedBuiltInVendorIds(), unreleasedBuiltInVendorIds());

  // A custom Vendor never becomes a registry entry and never enters the repair deletion set.
  for (const registry of [vendorRegistry, restored, added]) {
    assert.equal(registry.isBuiltInVendor(CUSTOM_VENDOR_ID), false);
    assert.equal(registry.isReleasedBuiltInVendor(CUSTOM_VENDOR_ID), false);
    assert.equal(registry.unreleasedBuiltInVendorIds().includes(CUSTOM_VENDOR_ID), false);
    assert.equal(registry.builtInVendorIds().includes(CUSTOM_VENDOR_ID), false);
  }
});
