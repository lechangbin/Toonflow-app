import assert from "node:assert/strict";
import test from "node:test";

import {
  validateVideoTrackInputReferences,
  videoGenerationBatchRequestSchema,
  videoGenerationItemSchema,
} from "../src/video/productionContract";

const baseItem = {
  trackId: 1,
  vendorId: "agnes",
  modelId: "agnes-video-v2.0",
  capabilityId: "keyframe-to-video",
  inputs: [
    { role: "first-frame", source: "storyboard", sourceId: 1 },
    { role: "intermediate-keyframe", source: "uploaded-media", filePath: "/middle.png" },
    { role: "last-frame", source: "asset", sourceId: 2 },
  ],
  output: { presetId: "720p", duration: 5, resolution: "720p", aspectRatio: "16:9" },
  audio: { generation: "native", enabled: true },
  promptRevisionId: 9,
};

test("the route contract carries explicit keyframe roles and an immutable prompt revision reference", () => {
  const parsed = videoGenerationItemSchema.parse(baseItem);
  assert.deepEqual(
    parsed.inputs.map((input) => input.role),
    ["first-frame", "intermediate-keyframe", "last-frame"],
  );
  assert.equal(parsed.promptRevisionId, 9);
});

test("the route contract rejects the former inline prompt-revision payload", () => {
  const { promptRevisionId: _promptRevisionId, ...legacyItem } = baseItem;
  assert.throws(() =>
    videoGenerationItemSchema.parse({
      ...legacyItem,
      promptRevision: { profileId: "agnes/keyframe-v1", strategy: "custom", renderedPrompt: "legacy" },
    }),
  );
});

test("single and batch generation share the same strict item contract", () => {
  const parsed = videoGenerationBatchRequestSchema.parse({
    projectId: 1,
    scriptId: 2,
    requestedBy: "project-agent",
    items: [baseItem],
  });
  assert.equal(parsed.items[0].capabilityId, "keyframe-to-video");
});

test("one Production Action cannot ambiguously configure the same Track twice", () => {
  assert.throws(() =>
    videoGenerationBatchRequestSchema.parse({
      projectId: 1,
      scriptId: 2,
      requestedBy: "user",
      items: [baseItem, baseItem],
    }),
  );
});

test("capability input validation rejects undeclared roles instead of ignoring them", () => {
  assert.throws(() =>
    validateVideoTrackInputReferences(
      {
        id: "first-last-frame",
        inputs: [
          { role: "first-frame", mediaType: "image", required: true },
          { role: "last-frame", mediaType: "image", required: true },
        ],
      },
      baseItem.inputs as any,
    ),
  );
});

test("Agnes accepts two or three explicitly assigned keyframes", () => {
  const capability = {
    id: "keyframe-to-video" as const,
    inputs: [
      { role: "first-frame" as const, mediaType: "image" as const, required: true as const },
      { role: "intermediate-keyframe" as const, mediaType: "image" as const, required: false as const },
      { role: "last-frame" as const, mediaType: "image" as const, required: true as const },
    ],
  } as const;
  assert.doesNotThrow(() => validateVideoTrackInputReferences(capability, [baseItem.inputs[0], baseItem.inputs[2]] as any));
  assert.doesNotThrow(() => validateVideoTrackInputReferences(capability, baseItem.inputs as any));
});
