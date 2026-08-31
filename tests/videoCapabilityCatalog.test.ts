import assert from "node:assert/strict";
import test from "node:test";

import knexFactory from "knex";

import { listEnabledVideoCapabilities } from "../src/video/capabilityCatalog";
import { workOf } from "./databaseTestSupport";

test("the enabled Video capability catalog omits credentials and Vendor source code", async () => {
  const db = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("o_vendorConfig", (table) => {
    table.string("id").primary();
    table.integer("enable");
    table.text("inputValues");
    table.text("models");
  });
  await db("o_vendorConfig").insert([
    { id: "agnes", enable: 1, inputValues: JSON.stringify({ apiKey: "secret" }), models: "[]" },
    { id: "minimax", enable: 0, inputValues: JSON.stringify({ apiKey: "also-secret" }), models: "[]" },
  ]);

  try {
    const catalog = await listEnabledVideoCapabilities({
      db: workOf(db),
      getVendor: async () => ({ id: "agnes", name: "Agnes AI", inputValues: { apiKey: "secret" }, sourceCode: "secret" }),
      getVendorModels: async () => [
        { name: "Agnes Text", modelName: "agnes-text", type: "text", think: true },
        {
          name: "Agnes Video V2.0",
          modelName: "agnes-video-v2.0",
          type: "video",
          capabilities: [
            {
              id: "text-to-video",
              promptProfileId: "agnes/text-v1",
              inputs: [],
              audio: { generation: "native", policy: "always" },
              outputPresets: [
                {
                  id: "480p",
                  resolution: "480p",
                  durations: { kind: "integer-range", min: 1, max: 18, step: 1 },
                  aspectRatios: ["16:9", "9:16"],
                },
              ],
            },
          ],
        },
      ],
    });

    assert.deepEqual(catalog, [
      {
        id: "agnes",
        name: "Agnes AI",
        models: [
          {
            name: "Agnes Video V2.0",
            modelId: "agnes-video-v2.0",
            capabilities: [
              {
                id: "text-to-video",
                promptProfileId: "agnes/text-v1",
                inputs: [],
                audio: { generation: "native", policy: "always" },
                outputPresets: [
                  {
                    id: "480p",
                    resolution: "480p",
                    durations: { kind: "integer-range", min: 1, max: 18, step: 1 },
                    aspectRatios: ["16:9", "9:16"],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    assert.equal(JSON.stringify(catalog).includes("secret"), false);
  } finally {
    await db.destroy();
  }
});
