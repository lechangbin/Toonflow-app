import assert from "node:assert/strict";
import test from "node:test";

import { resolveServerConfig } from "../src/server/config";

test("server configuration defaults to the local acceptance endpoint", () => {
  assert.deepEqual(resolveServerConfig({}), {
    host: "127.0.0.1",
    port: 10588,
  });
});

test("server configuration accepts an explicit container bind address and port", () => {
  assert.deepEqual(
    resolveServerConfig({
      HOST: "0.0.0.0",
      PORT: "11588",
    }),
    {
      host: "0.0.0.0",
      port: 11588,
    },
  );
});

test("server configuration rejects malformed ports before listening", () => {
  for (const port of ["0", "65536", "10588.5", "not-a-port"]) {
    assert.throws(() => resolveServerConfig({ PORT: port }), /PORT/);
  }
});
