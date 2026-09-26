import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";

import { VideoQuotePolicyConflictError } from "../src/controlledTools/videoQuotePolicy";
import { createVideoQuoteRouter } from "../src/routes/agentRuns/videoQuote";

const target = { projectId: 7, vendorId: "agnes", modelId: "model",
  capabilityId: "text-to-video", output: { presetId: "720p", duration: 5,
    resolution: "720p", aspectRatio: "16:9" },
  audio: { generation: "native", enabled: true } };

async function post(app: express.Express, path: string, body: unknown) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  } finally { server.close(); await once(server, "close"); }
}

function appWith(policy: unknown, userId: number) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { user: { id: number } }).user = { id: userId }; next();
  });
  app.use(createVideoQuoteRouter(policy as never));
  return app;
}

test("Video quote routes use authenticated actor, not a forged body identity", async () => {
  let seenGet = 0;
  let seenTarget: any;
  let seenSet: any;
  const policy = { get: async (requested: unknown, actorUserId: number) => {
    seenGet = actorUserId; seenTarget = requested; return null;
  }, set: async (input: unknown) => { seenSet = input; return { revision: 1 }; } };
  const app = appWith(policy, 42);
  assert.equal((await post(app, "/get", { ...target, actorUserId: 999 })).status, 200);
  assert.equal(seenGet, 42);
  assert.equal("actorUserId" in seenTarget, false);
  assert.equal((await post(app, "/set", { ...target, actorUserId: 999,
    expectedRevision: 0, estimatedMaxCostMicros: 200_000, currency: "USD" })).status, 200);
  assert.equal(seenSet.actorUserId, 42);
  assert.equal(seenSet.estimatedMaxCostMicros, 200_000);
  assert.equal((await post(appWith(policy, 0), "/set", { ...target,
    expectedRevision: 0, estimatedMaxCostMicros: 200_000, currency: "USD" })).status, 403);
});

test("Video quote route rejects invalid dimensions and stale revisions", async () => {
  const policy = { get: async () => null,
    set: async () => { throw new VideoQuotePolicyConflictError(); } };
  const app = appWith(policy, 42);
  assert.equal((await post(app, "/set", { ...target,
    output: { ...target.output, duration: 0 }, expectedRevision: 0,
    estimatedMaxCostMicros: 200_000, currency: "USD" })).status, 400);
  assert.equal((await post(app, "/set", { ...target, expectedRevision: 0,
    estimatedMaxCostMicros: 200_000, currency: "USD" })).status, 409);
});
