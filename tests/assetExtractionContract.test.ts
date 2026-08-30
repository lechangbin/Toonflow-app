import assert from "node:assert/strict";
import test from "node:test";
import { safeParseJSON } from "@ai-sdk/provider-utils";

import { assetExtractionToolInputSchema, parseAssetExtractionToolInput } from "../src/script/assetExtractionContract";

test("preserves canonical Asset Extraction arrays from a strict Model", () => {
  const input = {
    newAssets: [
      {
        name: "赤霄剑",
        desc: "刘邦所持佩剑",
        type: "tool" as const,
        scriptIds: [1],
      },
    ],
    existingAssetRefs: [{ name: "刘邦", scriptIds: [1] }],
  };

  assert.deepEqual(parseAssetExtractionToolInput(input), input);
});

test("normalizes JSON-encoded Asset Extraction arrays from a compatible Model", () => {
  const result = parseAssetExtractionToolInput({
    newAssets: JSON.stringify([
      {
        name: "刘邦",
        desc: "汉军统帅",
        type: "role",
        scriptIds: [1],
      },
    ]),
    existingAssetRefs: JSON.stringify([]),
  });

  assert.deepEqual(result, {
    newAssets: [
      {
        name: "刘邦",
        desc: "汉军统帅",
        type: "role",
        scriptIds: [1],
      },
    ],
    existingAssetRefs: [],
  });
});

test("normalizes compatible Model output at the AI SDK tool-input seam", async () => {
  const result = await safeParseJSON({
    text: JSON.stringify({
      newAssets: JSON.stringify([
        {
          name: "鸿门宴军帐",
          desc: "项羽设宴的中军大帐",
          type: "scene",
          scriptIds: [1],
        },
      ]),
      existingAssetRefs: JSON.stringify([]),
    }),
    schema: assetExtractionToolInputSchema,
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(Array.isArray(result.value.newAssets), true);
  assert.equal(result.value.newAssets[0].name, "鸿门宴军帐");
  assert.deepEqual(result.value.existingAssetRefs, []);
});

test("rejects unsupported Model output with an Asset Extraction contract error", () => {
  assert.throws(
    () =>
      parseAssetExtractionToolInput({
        newAssets: { assets: [] },
        existingAssetRefs: [],
      }),
    /资产提取结果格式无效.*newAssets/,
  );
});
