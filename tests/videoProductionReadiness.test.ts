import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { getDatabaseRuntime, openDatabase, type DatabaseWork } from "../src/database";
import { createVideoProduction } from "../src/video/production";
import { VideoPromptProfileRegistry } from "../src/video/promptProfile";
import { sleep, withDataRoot } from "./databaseTestSupport";

const PREFIX = "toonflow-prod-readiness-";

const model = {
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
          id: "720p",
          resolution: "720p",
          durations: { kind: "integer-range", min: 1, max: 18, step: 1 },
          aspectRatios: ["16:9"],
        },
      ],
    },
  ],
};

function loadProfiles() {
  return VideoPromptProfileRegistry.load(path.join(process.cwd(), "data", "promptProfiles", "video"));
}

function buildRequest(promptRevisionId: number) {
  return {
    projectId: 1,
    scriptId: 2,
    requestedBy: "user" as const,
    items: [
      {
        trackId: 501,
        vendorId: "agnes",
        modelId: "agnes-video-v2.0",
        capabilityId: "text-to-video",
        inputs: [],
        output: { presetId: "720p", duration: 6, resolution: "720p", aspectRatio: "16:9" },
        audio: { generation: "native", enabled: true },
        promptRevisionId,
      },
    ],
  };
}

async function seedTrackAndPromptRevision() {
  await getDatabaseRuntime().work(async (db) => {
    await db("o_videoTrack").insert({ id: 501, projectId: 1, scriptId: 2, state: "未生成" });
    await db("o_promptRevision").insert({
      id: 601,
      projectId: 1,
      videoTrackId: 501,
      profileId: "agnes/text-v1",
      strategy: "custom",
      brief: null,
      draft: null,
      renderedPrompt: "A lantern sways in the wind",
      status: "active",
      createdAt: 100,
    });
  });
}

test("the migrated production flow runs through the readiness seam and tracks the detached completion", async () => {
  await withDataRoot(PREFIX, async () => {
    await openDatabase();
    const profiles = loadProfiles();
    await seedTrackAndPromptRevision();

    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });

    const production = createVideoProduction({
      db: (operation) => getDatabaseRuntime().work(operation),
      profiles,
      loadRuntime: async () => ({
        getModel: () => model,
        getRequest: () => async () => {
          await providerGate;
          return "VIDEO_BASE64";
        },
      }),
      readImage: async () => {
        throw new Error("text-to-video must not load images");
      },
      writeVideo: async () => undefined,
      downloadVideo: async () => {
        throw new Error("base64 result must not download");
      },
      createVideoPath: () => "/1/video/detached.mp4",
      now: () => 300,
    });

    const started = await production.startVideoGenerationBatch(buildRequest(601));

    // The initiating call has returned; the action is still running while the
    // detached completion is blocked on the provider.
    const running = await getDatabaseRuntime().work((db) =>
      db("o_productionAction").where("id", started.actionId).first(),
    );
    assert.equal(running.status, "running", "the response returns before the detached completion finalizes");

    releaseProvider();
    await started.completion;

    const finished = await getDatabaseRuntime().work((db) =>
      db("o_productionAction").where("id", started.actionId).first(),
    );
    assert.equal(finished.status, "succeeded", "the detached completion finalizes the Production Action");

    // No lease may leak: maintenance must drain to zero and complete.
    assert.deepEqual(await getDatabaseRuntime().maintenance({ kind: "verify" }), { kind: "verify", verified: true });
  });
});

test("maintenance waits for an active detached completion write and new work parks behind it", async () => {
  await withDataRoot(PREFIX, async () => {
    await openDatabase();
    const profiles = loadProfiles();
    await seedTrackAndPromptRevision();

    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });

    let detached = false;
    let signalDetachedWrite!: () => void;
    const detachedWriteAcquired = new Promise<void>((resolve) => {
      signalDetachedWrite = resolve;
    });
    let releaseDetachedWrite!: () => void;
    const detachedWriteGate = new Promise<void>((resolve) => {
      releaseDetachedWrite = resolve;
    });

    const db: DatabaseWork = (operation) =>
      getDatabaseRuntime().work(async (database) => {
        if (detached) {
          signalDetachedWrite();
          await detachedWriteGate;
        }
        return operation(database);
      });

    const production = createVideoProduction({
      db,
      profiles,
      loadRuntime: async () => ({
        getModel: () => model,
        getRequest: () => async () => {
          await providerGate;
          return "VIDEO_BASE64";
        },
      }),
      readImage: async () => {
        throw new Error("text-to-video must not load images");
      },
      writeVideo: async () => undefined,
      downloadVideo: async () => {
        throw new Error("base64 result must not download");
      },
      createVideoPath: () => "/1/video/detached.mp4",
      now: () => 300,
    });

    const started = await production.startVideoGenerationBatch(buildRequest(601));

    // Only writes issued after the initiating call returns are "detached".
    detached = true;
    releaseProvider();

    // The detached transaction has now acquired its lease and is parked on the gate.
    await detachedWriteAcquired;

    let maintenanceDone = false;
    const maintenance = getDatabaseRuntime().maintenance({ kind: "verify" }).then((result) => {
      maintenanceDone = true;
      return result;
    });

    await sleep(30);
    assert.equal(maintenanceDone, false, "maintenance waits for the active detached write to release its lease");

    releaseDetachedWrite();
    await started.completion;
    assert.deepEqual(await maintenance, { kind: "verify", verified: true });

    assert.equal(getDatabaseRuntime().state, "ready", "the lease is released and access reopens");
  });
});
