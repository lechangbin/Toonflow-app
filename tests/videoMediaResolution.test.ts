import assert from "node:assert/strict";
import test from "node:test";

import { createVideoMediaResolver, VideoMediaResolutionError } from
  "../src/controlledTools/videoMediaResolution";

const mp4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0x69,
  0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]);

function fixture(addresses: string[] = ["8.8.8.8"]) {
  const calls: string[] = [];
  const resolve = createVideoMediaResolver({
    allowedHosts: ["media.example.com"],
    lookup: async (hostname) => { calls.push(`lookup:${hostname}`); return addresses; },
    fetch: async (url, address) => {
      calls.push(`fetch:${url.hostname}:${address}`); return mp4;
    },
  });
  return { resolve, calls };
}

test("controlled Video media accepts MP4 base64 without network and vetted HTTPS host with pinned DNS", async () => {
  const context = fixture();
  assert.equal(await context.resolve(mp4.toString("base64")), mp4.toString("base64"));
  assert.deepEqual(context.calls, []);
  assert.equal(await context.resolve("https://media.example.com/result.mp4?token=secret"),
    mp4.toString("base64"));
  assert.deepEqual(context.calls, ["lookup:media.example.com",
    "fetch:media.example.com:8.8.8.8"]);
});

test("controlled Video media rejects unlisted hosts, alternate schemes and credentials before DNS", async () => {
  const context = fixture();
  for (const result of ["http://media.example.com/result.mp4",
    "https://other.example.com/result.mp4",
    "https://user:pass@media.example.com/result.mp4",
    "https://127.0.0.1/result.mp4",
    "https://media.example.com:444/result.mp4",
    "https://media.example.com/result.mp4#fragment"]) {
    await assert.rejects(context.resolve(result), VideoMediaResolutionError);
  }
  assert.deepEqual(context.calls, []);
});

test("controlled Video media rejects private or mixed DNS and malformed media without fetching", async () => {
  const privateOnly = fixture(["127.0.0.1"]);
  await assert.rejects(privateOnly.resolve("https://media.example.com/result.mp4"),
    VideoMediaResolutionError);
  assert.deepEqual(privateOnly.calls, ["lookup:media.example.com"]);
  const mixed = fixture(["8.8.8.8", "169.254.169.254"]);
  await assert.rejects(mixed.resolve("https://media.example.com/result.mp4"),
    VideoMediaResolutionError);
  assert.deepEqual(mixed.calls, ["lookup:media.example.com"]);
  await assert.rejects(fixture().resolve(Buffer.from("not an mp4").toString("base64")),
    VideoMediaResolutionError);
  const malformed = createVideoMediaResolver({ allowedHosts: ["media.example.com"],
    lookup: async () => ["8.8.8.8"], fetch: async () => Buffer.from("not an mp4") });
  await assert.rejects(malformed("https://media.example.com/result.mp4"),
    VideoMediaResolutionError);
});
