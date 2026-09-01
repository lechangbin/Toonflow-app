import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(skillRoot, "fixtures");
const input = JSON.parse(readFileSync(join(fixtures, "historical-character-contrast.json"), "utf8"));
const expected = JSON.parse(readFileSync(join(fixtures, "historical-character-contrast.expected.json"), "utf8"));
const prompts = JSON.parse(readFileSync(join(fixtures, "historical-character-contrast.expected-prompts.json"), "utf8"));

const inputIds = input.input.assets.map((asset) => asset.assetId).sort((a, b) => a - b);
const briefs = expected.assetBriefs;
const briefIds = briefs.map((brief) => brief.assetId).sort((a, b) => a - b);

assert.deepEqual(briefIds, inputIds, "Expected output must contain every selected Asset exactly once");
assert.equal(new Set(briefIds).size, briefIds.length, "Expected Asset IDs must be unique");
assert.equal(expected.schemaVersion, "1.0");
assert.equal(expected.language, "zh-CN");
assert.ok(expected.contrastMatrix.length > 0, "Contrast Matrix must not be empty");

for (const brief of briefs) {
  assert.equal(brief.assetType, "character");
  assert.equal(brief.isDerived, false);
  assert.equal(brief.parentAssetId, null);
  assert.ok(brief.evidence.length > 0, `${brief.name} must retain evidence`);
  assert.ok(brief.differenceAnchors.length >= 2, `${brief.name} needs at least two difference anchors`);
  assert.ok(brief.design.negativeIdentity.length > 0, `${brief.name} needs negative identity`);
  const siblingIds = brief.contrastAgainstSiblingAssets.map((entry) => entry.assetId);
  assert.ok(inputIds.some((id) => id !== brief.assetId && siblingIds.includes(id)), `${brief.name} must contrast a sibling`);
  assert.equal(brief.referenceBindings.length, 0, "A no-reference fixture must not invent bindings");

  const prompt = prompts[String(brief.assetId)];
  assert.equal(typeof prompt, "string");
  assert.ok(prompt.includes(brief.name), `Prompt ${brief.assetId} must preserve the Asset name`);
  assert.ok(!/(Asset Brief|Contrast Matrix|分析过程)/u.test(prompt), `Prompt ${brief.assetId} leaked intermediate analysis`);
}

const [first, second] = briefs;
for (const field of ["socialRole", "silhouette", "hairStructure", "bodyPosture", "wardrobeStructure", "materialsCraft", "wearHistory"]) {
  assert.notEqual(first.design[field], second.design[field], `Character collision remains in design.${field}`);
}

for (const phrase of ["半束长发", "素色古装长衫", "基础色、无花纹装饰"]) {
  const collisionCount = Object.values(prompts).filter((prompt) => prompt.includes(phrase)).length;
  assert.ok(collisionCount < 2, `Both prompts regressed to the generic phrase: ${phrase}`);
}

console.log(`Validated ${briefs.length} differentiated Asset Briefs and ${Object.keys(prompts).length} final prompts.`);
