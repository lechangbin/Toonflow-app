import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { transform } from "sucrase";

import runCode from "../src/utils/vm";

const source = fs.readFileSync(path.join(process.cwd(), "data/vendor/agnes.ts"), "utf8");
const compiled = transform(source, { transforms: ["typescript"] }).code;

function loadAdapter(overrides: Record<string, unknown>) {
  const adapter = runCode(compiled, undefined, overrides);
  Object.assign(adapter.vendor.inputValues, {
    apiKey: "test-key",
    baseUrl: "https://agnes.invalid",
  });
  return adapter;
}

const alwaysNativeAudio = { generation: "native", enabled: true };

function textVideoCommand(overrides: Record<string, unknown> = {}) {
  return {
    capabilityId: "text-to-video",
    modelId: "agnes-video-v2.0",
    prompt: "A slow dolly-in toward a lantern.",
    output: { presetId: "720p", duration: 5, resolution: "720p", aspectRatio: "16:9" },
    audio: alwaysNativeAudio,
    ...overrides,
  };
}

function imageVideoCommand(base64 = "FRAME", overrides: Record<string, unknown> = {}) {
  return {
    ...textVideoCommand(),
    capabilityId: "image-to-video",
    sourceImage: { mediaType: "image", base64 },
    ...overrides,
  };
}

test("Agnes adapter advertises V2.0 without advertising Video 2.5", () => {
  const adapter = loadAdapter({});
  const videoModels = adapter.vendor.models.filter((model: any) => model.type === "video");

  assert.deepEqual(
    videoModels.map((model: any) => model.modelName),
    ["agnes-video-v2.0"],
  );
  assert.deepEqual(
    videoModels[0].capabilities.map((capability: any) => capability.id),
    ["text-to-video", "image-to-video", "keyframe-to-video"],
  );
  assert.ok(videoModels[0].capabilities.every((capability: any) => capability.audio.policy === "always"));
});

test("thinking mode is translated at the OpenAI-compatible HTTP boundary", async () => {
  let providerOptions: any;
  let outgoingBody: any;
  const adapter = loadAdapter({
    createOpenAICompatible: (options: any) => {
      providerOptions = options;
      return { chatModel: (modelName: string) => ({ modelName }) };
    },
    fetch: async (_url: string, options: any) => {
      outgoingBody = JSON.parse(options.body);
      return { ok: true };
    },
  });
  const model = adapter.vendor.models.find((item: any) => item.modelName === "agnes-2.5-flash");

  assert.deepEqual(adapter.textRequest(model, true, 0), { modelName: "agnes-2.5-flash" });
  await providerOptions.fetch("https://agnes.invalid/v1/chat/completions", {
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  });

  assert.equal(providerOptions.baseURL, "https://agnes.invalid/v1");
  assert.equal(outgoingBody.chat_template_kwargs.enable_thinking, true);
});

test("image editing normalizes raw Base64 references to documented Data URIs", async () => {
  let submitted: any;
  const adapter = loadAdapter({
    axios: {
      post: async (_url: string, body: any) => {
        submitted = body;
        return { data: { data: [{ b64_json: "RESULT" }] } };
      },
    },
  });
  const model = adapter.vendor.models.find((item: any) => item.modelName === "agnes-image-2.1-flash");

  const result = await adapter.imageRequest(
    {
      prompt: "Keep the subject and change the background.",
      referenceList: [{ type: "image", sourceType: "base64", base64: "RAW_IMAGE" }],
      size: "2K",
      aspectRatio: "16:9",
    },
    model,
  );

  assert.equal(submitted.size, "2K");
  assert.equal(submitted.ratio, "16:9");
  assert.deepEqual(submitted.extra_body.image, ["data:image/png;base64,RAW_IMAGE"]);
  assert.equal(result, "data:image/png;base64,RESULT");
});

test("Agnes image models enforce their configured six-reference limit", async () => {
  let submitted: any;
  const adapter = loadAdapter({
    axios: {
      post: async (_url: string, body: any) => {
        submitted = body;
        return { data: { data: [{ b64_json: "RESULT" }] } };
      },
    },
  });
  const model = adapter.vendor.models.find((item: any) => item.modelName === "agnes-image-2.1-flash");

  await adapter.imageRequest(
    {
      prompt: "Compose the selected references.",
      referenceList: Array.from({ length: 7 }, (_, index) => ({
        type: "image",
        sourceType: "base64",
        base64: `REFERENCE_${index + 1}`,
      })),
      size: "1K",
      aspectRatio: "16:9",
    },
    model,
  );

  assert.equal(model.maxReferenceImages, 6);
  assert.deepEqual(
    submitted.extra_body.image,
    Array.from({ length: 6 }, (_, index) => `data:image/png;base64,REFERENCE_${index + 1}`),
  );
});

test("V2.0 text-to-video submits documented dimensions and an 8n+1 frame count", async () => {
  let submitted: any;
  const adapter = loadAdapter({
    axios: {
      post: async (_url: string, body: any) => {
        submitted = body;
        return { data: { video_id: "video-1" } };
      },
      get: async () => ({ data: { status: "completed", metadata: { url: "https://result.invalid/video.mp4" } } }),
    },
    pollTask: async (poll: () => Promise<any>) => poll(),
    urlToBase64: async (url: string) => `encoded:${url}`,
  });
  const model = adapter.vendor.models.find((item: any) => item.modelName === "agnes-video-v2.0");

  const result = await adapter.videoRequest(
    textVideoCommand(),
    model,
  );

  assert.equal(submitted.width, 1280);
  assert.equal(submitted.height, 704);
  assert.equal(submitted.frame_rate, 24);
  assert.equal(submitted.num_frames % 8, 1);
  assert.equal(result, "encoded:https://result.invalid/video.mp4");
});

test("V2.0 keyframe mode preserves explicit first, intermediate, and last roles", async () => {
  let submitted: any;
  const adapter = loadAdapter({
    axios: {
      post: async (_url: string, body: any) => {
        submitted = body;
        return { data: { task_id: "task-1" } };
      },
      get: async () => ({ data: { status: "succeeded", url: "https://result.invalid/keyframes.mp4" } }),
    },
    pollTask: async (poll: () => Promise<any>) => poll(),
    urlToBase64: async (url: string) => `encoded:${url}`,
  });
  const model = adapter.vendor.models.find((item: any) => item.modelName === "agnes-video-v2.0");

  await adapter.videoRequest(
    {
      capabilityId: "keyframe-to-video",
      modelId: "agnes-video-v2.0",
      prompt: "The subject turns toward camera.",
      firstFrame: { mediaType: "image", base64: "data:image/png;base64,FIRST" },
      intermediateKeyframe: { mediaType: "image", base64: "data:image/png;base64,MIDDLE" },
      lastFrame: { mediaType: "image", base64: "data:image/png;base64,LAST" },
      output: { presetId: "480p", duration: 4, resolution: "480p", aspectRatio: "9:16" },
      audio: alwaysNativeAudio,
    },
    model,
  );

  assert.deepEqual(submitted.extra_body, {
    image: ["data:image/png;base64,FIRST", "data:image/png;base64,MIDDLE", "data:image/png;base64,LAST"],
    mode: "keyframes",
  });
  assert.equal(submitted.width, 448);
  assert.equal(submitted.height, 832);
});

test("V2.0 image-to-video maps the explicit source-image role and normalizes raw Base64", async () => {
  let submitted: any;
  const adapter = loadAdapter({
    axios: {
      post: async (_url: string, body: any) => {
        submitted = body;
        return { data: { video_id: "video-string-mode" } };
      },
      get: async () => ({ data: { status: "completed", metadata: { url: "https://result.invalid/image.mp4" } } }),
    },
    pollTask: async (poll: () => Promise<any>) => poll(),
    urlToBase64: async (url: string) => `encoded:${url}`,
  });
  const model = adapter.vendor.models.find((item: any) => item.modelName === "agnes-video-v2.0");

  await adapter.videoRequest(
    imageVideoCommand("RAW_FRAME", {
      prompt: "Subtle breathing motion while the face remains stable.",
      output: { presetId: "720p", duration: 3, resolution: "720p", aspectRatio: "16:9" },
    }),
    model,
  );

  assert.equal(submitted.image, "data:image/png;base64,RAW_FRAME");
});

test("V2.0 retries a temporary poll 503 without submitting a second task", async () => {
  let postCount = 0;
  let getCount = 0;
  const adapter = loadAdapter({
    axios: {
      post: async () => {
        postCount += 1;
        return { data: { video_id: "video-retry-503" } };
      },
      get: async () => {
        getCount += 1;
        if (getCount === 1) {
          throw {
            message: "Request failed with status code 503",
            response: {
              status: 503,
              data: { error: { code: "temporarily_unavailable", message: "please retry later" } },
            },
          };
        }
        return { data: { status: "completed", metadata: { url: "https://result.invalid/retried.mp4" } } };
      },
    },
    pollTask: async (poll: () => Promise<any>) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await poll();
        if (result.completed || result.error) return result;
      }
      return { completed: false, error: "test poll exhausted" };
    },
    sleep: async () => {},
    urlToBase64: async (url: string) => `encoded:${url}`,
  });
  const model = adapter.vendor.models.find((item: any) => item.modelName === "agnes-video-v2.0");

  const result = await adapter.videoRequest(
    imageVideoCommand("FRAME", {
      prompt: "A portrait remains stable while the camera slowly moves closer.",
      output: { presetId: "480p", duration: 5, resolution: "480p", aspectRatio: "16:9" },
    }),
    model,
  );

  assert.equal(result, "encoded:https://result.invalid/retried.mp4");
  assert.equal(postCount, 1);
  assert.equal(getCount, 2);
});

test("V2.0 backs off and retries an explicitly rejected full queue submission", async () => {
  let postCount = 0;
  const waits: number[] = [];
  const adapter = loadAdapter({
    axios: {
      post: async () => {
        postCount += 1;
        if (postCount < 3) {
          throw {
            message: "Request failed with status code 503",
            response: {
              status: 503,
              data: { error: { code: "video_queue_full", message: "video queue is full, please retry later" } },
            },
          };
        }
        return { data: { task_id: "task-after-queue" } };
      },
      get: async () => ({ data: { status: "completed", url: "https://result.invalid/queue-retried.mp4" } }),
    },
    pollTask: async (poll: () => Promise<any>) => poll(),
    sleep: async (milliseconds: number) => waits.push(milliseconds),
    urlToBase64: async (url: string) => `encoded:${url}`,
  });
  const model = adapter.vendor.models.find((item: any) => item.modelName === "agnes-video-v2.0");

  const result = await adapter.videoRequest(
    imageVideoCommand("FRAME", {
      prompt: "Wait for provider capacity.",
      output: { presetId: "480p", duration: 5, resolution: "480p", aspectRatio: "16:9" },
    }),
    model,
  );

  assert.equal(result, "encoded:https://result.invalid/queue-retried.mp4");
  assert.equal(postCount, 3);
  assert.equal(waits.length, 2);
  assert.ok(waits[0] >= 10000);
  assert.ok(waits[1] >= waits[0]);
});

test("V2.0 disables proxy inheritance for the final result download", async () => {
  let downloadConfig: any;
  const adapter = loadAdapter({
    axios: {
      post: async () => ({ data: { task_id: "task-download-proxy" } }),
      get: async () => ({ data: { status: "completed", url: "https://result.invalid/no-proxy.mp4" } }),
    },
    pollTask: async (poll: () => Promise<any>) => poll(),
    urlToBase64: async (_url: string, config: any) => {
      downloadConfig = config;
      return "encoded-video";
    },
  });
  const model = adapter.vendor.models.find((item: any) => item.modelName === "agnes-video-v2.0");

  await adapter.videoRequest(
    imageVideoCommand("FRAME", {
      prompt: "Subtle movement.",
      output: { presetId: "480p", duration: 5, resolution: "480p", aspectRatio: "16:9" },
    }),
    model,
  );

  assert.deepEqual(downloadConfig, { proxy: false, timeout: 120000 });
});

test("V2.0 retries a transient completed-result download with a bounded timeout", async () => {
  const downloadConfigs: any[] = [];
  const waits: number[] = [];
  let downloadCount = 0;
  const adapter = loadAdapter({
    axios: {
      post: async () => ({ data: { task_id: "task-download-timeout" } }),
      get: async () => ({ data: { status: "completed", url: "https://result.invalid/eventually.mp4" } }),
    },
    pollTask: async (poll: () => Promise<any>) => poll(),
    sleep: async (milliseconds: number) => waits.push(milliseconds),
    urlToBase64: async (_url: string, config: any) => {
      downloadCount += 1;
      downloadConfigs.push(config);
      if (downloadCount === 1) {
        throw { code: "ETIMEDOUT", message: "result download timed out" };
      }
      if (downloadCount === 2) {
        throw {
          message: "result CDN temporarily unavailable",
          response: { status: 520, data: { message: "result CDN temporarily unavailable" } },
        };
      }
      return "encoded-video";
    },
  });
  const model = adapter.vendor.models.find((item: any) => item.modelName === "agnes-video-v2.0");

  const result = await adapter.videoRequest(
    textVideoCommand({
      prompt: "Download a completed provider task without hanging forever.",
      output: { presetId: "480p", duration: 5, resolution: "480p", aspectRatio: "16:9" },
    }),
    model,
  );

  assert.equal(result, "encoded-video");
  assert.equal(downloadCount, 3);
  assert.equal(waits.length, 2);
  assert.ok(downloadConfigs.every((config) => config.proxy === false));
  assert.ok(downloadConfigs.every((config) => config.timeout === 120000));
});

test("V2.0 checkpoints the provider task before polling and can resume without POST", async () => {
  const checkpoints: any[] = [];
  let postCount = 0;
  const adapter = loadAdapter({
    axios: {
      post: async () => {
        postCount += 1;
        return { data: { task_id: "unexpected-new-task" } };
      },
      get: async () => ({ data: { status: "completed", url: "https://result.invalid/resumed.mp4" } }),
    },
    pollTask: async (poll: () => Promise<any>) => poll(),
    urlToBase64: async (url: string) => `encoded:${url}`,
  });
  const model = adapter.vendor.models.find((item: any) => item.modelName === "agnes-video-v2.0");

  const result = await adapter.videoRequest(
    textVideoCommand({
      prompt: "Resume an existing provider task.",
      output: { presetId: "480p", duration: 5, resolution: "480p", aspectRatio: "16:9" },
      resumeTask: { taskId: "task-existing" },
      onTaskCheckpoint: async (checkpoint: any) => checkpoints.push(checkpoint),
    }),
    model,
  );

  assert.equal(result, "encoded:https://result.invalid/resumed.mp4");
  assert.equal(postCount, 0);
  assert.deepEqual(
    checkpoints.map((checkpoint) => checkpoint.stage),
    ["poll", "download"],
  );
  assert.ok(checkpoints.every((checkpoint) => checkpoint.taskId === "task-existing"));
});

test("V2.0 errors identify stage, HTTP status, provider code, task id, and retry count", async () => {
  const adapter = loadAdapter({
    axios: {
      post: async () => ({ data: { task_id: "task-download-error" } }),
      get: async () => ({ data: { status: "completed", url: "https://result.invalid/unreachable.mp4" } }),
    },
    pollTask: async (poll: () => Promise<any>) => poll(),
    sleep: async () => {},
    urlToBase64: async () => {
      throw {
        code: "ECONNREFUSED",
        config: { headers: { Authorization: "Bearer should-not-appear" } },
      };
    },
  });
  const model = adapter.vendor.models.find((item: any) => item.modelName === "agnes-video-v2.0");

  await assert.rejects(
    adapter.videoRequest(
      textVideoCommand({
        prompt: "Download the completed task.",
        output: { presetId: "480p", duration: 5, resolution: "480p", aspectRatio: "16:9" },
      }),
      model,
    ),
    (error: any) => {
      assert.match(error.message, /stage=download/);
      assert.match(error.message, /task_id=task-download-error/);
      assert.match(error.message, /retry=2/);
      assert.match(error.message, /ECONNREFUSED/);
      assert.doesNotMatch(error.message, /\[object Object\]/);
      assert.doesNotMatch(error.message, /should-not-appear/);
      return true;
    },
  );
});

// ─── 图片生成超时与生命周期（Issue #39） ─────────────────────────────────────

function imageModel() {
  const adapter = loadAdapter({});
  return adapter.vendor.models.find((item: any) => item.modelName === "agnes-image-2.1-flash");
}

test("image request timeout is classified and never auto-replayed", async () => {
  let postCount = 0;
  const adapter = loadAdapter({
    axios: {
      post: async () => {
        postCount += 1;
        throw { code: "ECONNABORTED", message: "timeout of 360000ms exceeded" };
      },
    },
  });

  await assert.rejects(
    adapter.imageRequest({ prompt: "A lantern in the dark.", size: "1K", aspectRatio: "16:9" }, imageModel()),
    (error: any) => {
      assert.equal(postCount, 1, "超时结果不确定，绝不自动重放 POST");
      assert.equal(error.imageFailure.kind, "timeout");
      assert.equal(error.imageFailure.stage, "generation");
      assert.equal(error.imageFailure.attempt, 1);
      assert.equal(error.imageFailure.transportCode, "ECONNABORTED");
      assert.equal(typeof error.imageFailure.elapsedMs, "number");
      assert.match(error.message, /kind=timeout/);
      return true;
    },
  );
});

test("image connection reset is not auto-replayed", async () => {
  let postCount = 0;
  const adapter = loadAdapter({
    axios: {
      post: async () => {
        postCount += 1;
        throw { code: "ECONNRESET", message: "socket hang up" };
      },
    },
  });

  await assert.rejects(
    adapter.imageRequest({ prompt: "A closed gate.", size: "1K", aspectRatio: "16:9" }, imageModel()),
    (error: any) => {
      assert.equal(postCount, 1, "连接重置结果不确定，绝不自动重放 POST");
      assert.equal(error.imageFailure.kind, "transport");
      assert.equal(error.imageFailure.transportCode, "ECONNRESET");
      return true;
    },
  );
});

test("image server errors are never auto-replayed", async () => {
  let postCount = 0;
  const adapter = loadAdapter({
    axios: {
      post: async () => {
        postCount += 1;
        throw { response: { status: 503, data: { message: "upstream unavailable" } } };
      },
    },
  });

  await assert.rejects(
    adapter.imageRequest({ prompt: "A quiet courtyard.", size: "1K", aspectRatio: "16:9" }, imageModel()),
    (error: any) => {
      assert.equal(postCount, 1, "5xx 可能已被供应商处理，绝不自动重放 POST");
      assert.equal(error.imageFailure.kind, "httpError");
      assert.equal(error.imageFailure.httpStatus, 503);
      return true;
    },
  );
});

test("explicit 429 rejection is safely retried with a bounded attempt count", async () => {
  let postCount = 0;
  const adapter = loadAdapter({
    axios: {
      post: async () => {
        postCount += 1;
        if (postCount < 3) throw { response: { status: 429, data: {} } };
        return { data: { data: [{ b64_json: "RESULT" }] } };
      },
    },
    pollTask: async () => ({ completed: true }),
  });

  const result = await adapter.imageRequest(
    { prompt: "A rate-limited request.", size: "1K", aspectRatio: "16:9" },
    imageModel(),
  );

  assert.equal(result, "data:image/png;base64,RESULT");
  assert.equal(postCount, 3, "明确收到的限流拒绝允许有限重试");
});

test("explicit busy 400 is retried while other 400s fail immediately", async () => {
  let busyCount = 0;
  const busyAdapter = loadAdapter({
    axios: {
      post: async () => {
        busyCount += 1;
        if (busyCount < 2) {
          throw { response: { status: 400, data: { error: { message: "service is busy, please retry later" } } } };
        }
        return { data: { data: [{ b64_json: "BUSY-OK" }] } };
      },
    },
    pollTask: async () => ({ completed: true }),
  });

  const busyResult = await busyAdapter.imageRequest(
    { prompt: "A busy provider.", size: "1K", aspectRatio: "16:9" },
    imageModel(),
  );
  assert.equal(busyResult, "data:image/png;base64,BUSY-OK");
  assert.equal(busyCount, 2, "明确收到的繁忙拒绝允许有限重试");

  let invalidCount = 0;
  const invalidAdapter = loadAdapter({
    axios: {
      post: async () => {
        invalidCount += 1;
        throw { response: { status: 400, data: { error: { message: "invalid prompt content" } } } };
      },
    },
    pollTask: async () => ({ completed: true }),
  });

  await assert.rejects(
    invalidAdapter.imageRequest({ prompt: "A rejected prompt.", size: "1K", aspectRatio: "16:9" }, imageModel()),
    (error: any) => {
      assert.equal(invalidCount, 1, "普通 400 是明确拒绝，不重试");
      assert.equal(error.imageFailure.kind, "httpError");
      return true;
    },
  );
});

test("image failure diagnostics omit provider free text and reject unsafe request IDs", async () => {
  const adapter = loadAdapter({
    axios: {
      post: async () => {
        throw {
          response: {
            status: 500,
            headers: { "x-request-id": "Bearer sk-short" },
            data: {
              error: {
                message:
                  "failed https://signed.example.com/file?token=SECRETVALUE " +
                  "QUJD".repeat(60) +
                  " trailing text",
              },
            },
          },
        };
      },
    },
  });

  await assert.rejects(
    adapter.imageRequest({ prompt: "A sanitized failure.", size: "1K", aspectRatio: "16:9" }, imageModel()),
    (error: any) => {
      const serialized = JSON.stringify(error.imageFailure);
      assert.ok(!serialized.includes("SECRETVALUE"), "签名 URL 凭证不得出现在诊断");
      assert.ok(!serialized.includes("test-key"), "API Key 不得出现在诊断");
      assert.ok(!serialized.includes("QUJD".repeat(30)), "base64 长串不得出现在诊断");
      assert.ok(!serialized.includes("A sanitized failure."), "提示词不得出现在诊断");
      assert.ok(!serialized.includes("sk-short"), "短凭证不得出现在诊断");
      assert.ok(!('message' in error.imageFailure), "供应商自由文本不得离开适配器");
      assert.equal(error.imageFailure.httpStatus, 500);
      assert.equal(error.imageFailure.providerRequestId, undefined);
      return true;
    },
  );
});

test("image stages begin only after the serialized vendor slot is acquired", async () => {
  let releaseFirst!: () => void;
  const firstResponse = new Promise<any>((resolve) => {
    releaseFirst = () => resolve({ data: { data: [{ b64_json: "FIRST" }] } });
  });
  let postCount = 0;
  const adapter = loadAdapter({
    axios: {
      post: async () => {
        postCount += 1;
        return postCount === 1 ? firstResponse : { data: { data: [{ b64_json: "SECOND" }] } };
      },
    },
  });
  const firstEvents: string[] = [];
  const secondEvents: string[] = [];
  const first = adapter.imageRequest(
    { prompt: "First.", size: "1K", aspectRatio: "1:1", onStage: async (stage: string) => firstEvents.push(stage) },
    imageModel(),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const second = adapter.imageRequest(
    { prompt: "Second.", size: "1K", aspectRatio: "1:1", onStage: async (stage: string) => secondEvents.push(stage) },
    imageModel(),
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(firstEvents, ["generating"]);
  assert.deepEqual(secondEvents, [], "仍在本地串行队列中的请求不得宣称生成中");
  assert.equal(postCount, 1);

  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(secondEvents, ["generating"], "获得执行槽、即将 POST 时才进入生成中");
  assert.equal(postCount, 2);
});

test("URL results enter downloading stage before media download; Base64 results skip it", async () => {
  const events: string[] = [];
  const urlAdapter = loadAdapter({
    axios: {
      post: async () => ({ data: { data: [{ url: "https://result.invalid/image.png" }] } }),
    },
    urlToBase64: async () => {
      events.push("download");
      return "URL-RESULT";
    },
  });

  const urlResult = await urlAdapter.imageRequest(
    {
      prompt: "A URL result.",
      size: "1K",
      aspectRatio: "16:9",
      onStage: async (stage: string) => events.push(stage),
    },
    imageModel(),
  );
  assert.equal(urlResult, "URL-RESULT");
  assert.deepEqual(events, ["generating", "downloading", "download", "downloaded"], "生成与下载阶段必须对应真实边界");

  const b64Events: string[] = [];
  const b64Adapter = loadAdapter({
    axios: {
      post: async () => ({ data: { data: [{ b64_json: "B64-RESULT" }] } }),
    },
    urlToBase64: async () => {
      b64Events.push("download");
      return "SHOULD-NOT-HAPPEN";
    },
  });

  const b64Result = await b64Adapter.imageRequest(
    {
      prompt: "A Base64 result.",
      size: "1K",
      aspectRatio: "16:9",
      onStage: async (stage: string) => b64Events.push(stage),
    },
    imageModel(),
  );
  assert.equal(b64Result, "data:image/png;base64,B64-RESULT");
  assert.deepEqual(b64Events, ["generating"], "Base64 直接返回，只触发真实供应商调用阶段");
});

test("URL media download failure is classified as downloadFailed at download stage", async () => {
  const adapter = loadAdapter({
    axios: {
      post: async () => ({ data: { data: [{ url: "https://result.invalid/broken.png" }] } }),
    },
    urlToBase64: async () => {
      throw { code: "ECONNRESET", message: "download aborted" };
    },
  });

  await assert.rejects(
    adapter.imageRequest({ prompt: "A broken download.", size: "1K", aspectRatio: "16:9" }, imageModel()),
    (error: any) => {
      assert.equal(error.imageFailure.kind, "downloadFailed");
      assert.equal(error.imageFailure.stage, "download");
      assert.equal(error.imageFailure.transportCode, "ECONNRESET");
      return true;
    },
  );
});

test("image request logs local facts instead of provider acknowledgement", async () => {
  const logs: string[] = [];
  const adapter = loadAdapter({
    axios: {
      post: async () => ({ data: { data: [{ b64_json: "LOG-RESULT" }] } }),
    },
    logger: (message: string) => logs.push(message),
  });

  await adapter.imageRequest({ prompt: "A local fact.", size: "1K", aspectRatio: "16:9" }, imageModel());

  assert.ok(logs.some((line) => line.includes("开始本地供应商请求")), "日志必须描述本地请求事实");
  assert.ok(logs.every((line) => !line.includes("已进入生成队列")), "不得声称云端已确认排队");
});
