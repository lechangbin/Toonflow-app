import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";

import { createHealthRouter } from "../src/server/health";

test("health endpoint is reachable without authentication", async () => {
  const app = express();
  app.use(createHealthRouter());
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  } finally {
    server.close();
    await once(server, "close");
  }
});
