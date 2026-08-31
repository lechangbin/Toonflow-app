import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../src/database";
import { createDefaultConfiguredVendor, type VideoModelSummary } from "../src/vendor";
import { withDataRoot } from "./databaseTestSupport";

const PREFIX = "toonflow-release-candidate-";

test("startup ordering validates configured Vendors only after database readiness", async () => {
  await withDataRoot(PREFIX, async () => {
    const runtime = await openDatabase();
    assert.equal(runtime.state, "ready");

    const vendor = createDefaultConfiguredVendor();
    const validation = await vendor.validateStartup();
    assert.ok(
      validation.vendorIds.includes("agnes"),
      "the seeded Agnes configuration is validated through the configured Vendor module",
    );
    assert.ok(validation.modelCount > 0, "the released Vendor sources expose their models");

    const inspection = await vendor.inspectVendor("agnes");
    const videoModel = inspection.models.find((m): m is VideoModelSummary => m.type === "video");
    assert.ok(videoModel, "Agnes exposes its Video Model through the configured loader");
    assert.ok(videoModel.capabilities.length > 0, "the Video Model declares its capabilities");
  });
});

test("Vendor operations keep working after maintenance replays the readiness lifecycle", async () => {
  await withDataRoot(PREFIX, async () => {
    const runtime = await openDatabase();
    const vendor = createDefaultConfiguredVendor();
    const before = await vendor.inspectVendor("agnes");

    const verified = await runtime.maintenance({ kind: "verify" });
    assert.deepEqual(verified, { kind: "verify", verified: true });
    assert.equal(runtime.state, "ready", "access reopens after maintenance");

    const after = await vendor.inspectVendor("agnes");
    assert.deepEqual(after.models, before.models, "the configured loader serves identical models after maintenance");

    const listed = await vendor.listVendors();
    assert.ok(listed.some((summary) => summary.vendorId === "agnes"), "vendor listing still works post-maintenance");
  });
});
