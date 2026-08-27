import assert from "node:assert/strict";
import test from "node:test";

import {
  VideoCapabilityError,
  parseVideoModel,
  validateVideoGenerationCommand,
  type VideoModel,
} from "../src/video/capability";

const outputs = [
  {
    id: "720p",
    resolution: "720p",
    durations: { kind: "integer-range" as const, min: 1, max: 18, step: 1 },
    aspectRatios: ["16:9" as const, "9:16" as const],
  },
];

const agnesModel: VideoModel = {
  name: "Agnes Video V2.0",
  modelName: "agnes-video-v2.0",
  type: "video",
  capabilities: [
    {
      id: "text-to-video",
      promptProfileId: "agnes/text-v1",
      inputs: [],
      audio: { generation: "native", policy: "always" },
      outputPresets: outputs,
    },
    {
      id: "keyframe-to-video",
      promptProfileId: "agnes/keyframe-v1",
      inputs: [
        { role: "first-frame", mediaType: "image", required: true },
        { role: "intermediate-keyframe", mediaType: "image", required: false },
        { role: "last-frame", mediaType: "image", required: true },
      ],
      transitions: { kind: "adjacent-keyframes" },
      audio: { generation: "native", policy: "always" },
      outputPresets: outputs,
    },
  ],
};

test("legacy Video Model mode is rejected", () => {
  assert.throws(
    () =>
      parseVideoModel({
        ...agnesModel,
        mode: ["text", "singleImage"],
      }),
    (error: any) => error instanceof VideoCapabilityError && error.code === "MODEL_CONTRACT_INVALID",
  );
});

test("Agnes accepts explicit three-keyframe commands with always-on native audio", () => {
  const command = validateVideoGenerationCommand(agnesModel, {
    capabilityId: "keyframe-to-video",
    modelId: "agnes-video-v2.0",
    prompt: "Move through all three temporal targets.",
    firstFrame: { mediaType: "image", base64: "FIRST" },
    intermediateKeyframe: { mediaType: "image", base64: "MIDDLE" },
    lastFrame: { mediaType: "image", base64: "LAST" },
    output: { presetId: "720p", resolution: "720p", duration: 5, aspectRatio: "16:9" },
    audio: { generation: "native", enabled: true },
  });

  assert.equal(command.capabilityId, "keyframe-to-video");
  assert.equal(command.intermediateKeyframe?.base64, "MIDDLE");
});

test("capability validation rejects disabling Agnes audio", () => {
  assert.throws(
    () =>
      validateVideoGenerationCommand(agnesModel, {
        capabilityId: "text-to-video",
        modelId: "agnes-video-v2.0",
        prompt: "A quiet room.",
        output: { presetId: "720p", resolution: "720p", duration: 5, aspectRatio: "16:9" },
        audio: { generation: "native", enabled: false },
      }),
    (error: any) => error instanceof VideoCapabilityError && error.code === "AUDIO_CONTRACT_MISMATCH",
  );
});

test("output selection must match the declared preset", () => {
  assert.throws(
    () =>
      validateVideoGenerationCommand(agnesModel, {
        capabilityId: "text-to-video",
        modelId: "agnes-video-v2.0",
        prompt: "A quiet room.",
        output: { presetId: "720p", resolution: "720p", duration: 19, aspectRatio: "16:9" },
        audio: { generation: "native", enabled: true },
      }),
    (error: any) => error instanceof VideoCapabilityError && error.code === "OUTPUT_SELECTION_INVALID",
  );
});
