import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import express from "express";

import { createBatchGenerateVideoRouter } from
  "../src/routes/production/workbench/batchGenerateVideo";
import { createGenerateVideoRouter } from
  "../src/routes/production/workbench/generateVideo";
import { createGenerateVideoPromptRouter } from
  "../src/routes/production/workbench/generateVideoPrompt";
import { createBatchGeneratePromptRouter } from
  "../src/routes/production/workbench/batchGeneratePrompt";
import { createUpdateVideoPromptRouter } from
  "../src/routes/production/workbench/updateVideoPrompt";

const item = { trackId: 31, vendorId: "agnes", modelId: "video-v1",
  capabilityId: "text-to-video", inputs: [],
  output: { presetId: "720p", duration: 4, resolution: "720p",
    aspectRatio: "16:9" },
  audio: { generation: "native", enabled: true }, promptRevisionId: 51 };

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
    return response.status;
  } finally { server.close(); await once(server, "close"); }
}

test("manual single and batch Video routes cannot claim Project Agent origin", async () => {
  const started: unknown[] = [];
  const fake = async (input: unknown) => {
    started.push(input);
    return { actionId: 1, tasks: [{ trackId: 31, videoId: 61,
      generationTaskId: 71, artifactRevisionId: 81 }],
    completion: Promise.resolve() };
  };
  const app = express();
  app.use(express.json());
  app.use("/single", createGenerateVideoRouter(fake as never));
  app.use("/batch", createBatchGenerateVideoRouter(fake as never));
  const base = { projectId: 7, scriptId: 11 };
  assert.equal(await post(app, "/single", { ...base, requestedBy: "project-agent", item }), 422);
  assert.equal(await post(app, "/batch", { ...base, requestedBy: "project-agent",
    items: [item] }), 422);
  assert.equal(started.length, 0, "a forged origin must not reach the Vendor orchestration seam");
  assert.equal(await post(app, "/single", { ...base, item }), 200);
  assert.equal(await post(app, "/batch", { ...base, requestedBy: "user",
    items: [item] }), 200);
  assert.deepEqual(started.map((value) => (value as { requestedBy: string }).requestedBy),
    ["user", "user"]);
});

test("manual prompt generation and revision routes cannot claim Project Agent origin", async () => {
  const called: unknown[] = [];
  const fake = async (input: unknown) => {
    called.push(input);
    return { promptRevisionId: 51 };
  };
  const app = express();
  app.use(express.json());
  app.use("/prompt", createGenerateVideoPromptRouter(fake as never));
  app.use("/batch-prompt", createBatchGeneratePromptRouter(fake as never));
  app.use("/revision", createUpdateVideoPromptRouter(fake as never));
  const { promptRevisionId: _promptRevisionId, ...selection } = item;
  const base = { ...selection, projectId: 7 };
  const prompt = { ...base, strategy: "standard", brief: {
    subject: "A lantern", motion: "Slowly sways in the wind",
  } };
  const revision = { ...base, renderedPrompt: "A lantern sways in the wind" };

  assert.equal(await post(app, "/prompt", { ...prompt, requestedBy: "project-agent" }), 422);
  assert.equal(await post(app, "/batch-prompt", { items: [
    { ...prompt, requestedBy: "user" }, { ...prompt, requestedBy: "project-agent" },
  ] }), 422);
  assert.equal(await post(app, "/revision", { ...revision, requestedBy: "project-agent" }), 422);
  assert.equal(called.length, 0, "forged origin cannot reach prompt generation or revision");

  assert.equal(await post(app, "/prompt", prompt), 200);
  assert.equal(await post(app, "/batch-prompt", { items: [prompt] }), 200);
  assert.equal(await post(app, "/revision", revision), 200);
  assert.deepEqual(called.map((value) => (value as { requestedBy: string }).requestedBy),
    ["user", "user", "user"]);
});
