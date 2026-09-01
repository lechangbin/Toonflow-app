import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(skillRoot, "fixtures");
const input = JSON.parse(readFileSync(join(fixtures, "historical-character-contrast.json"), "utf8"));
const expected = JSON.parse(readFileSync(join(fixtures, "historical-character-contrast.expected.json"), "utf8"));
const prompts = JSON.parse(readFileSync(join(fixtures, "historical-character-contrast.expected-prompts.json"), "utf8"));
const crossType = JSON.parse(readFileSync(join(fixtures, "cross-type-compiler-cases.json"), "utf8"));

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

const controlledDimensions = new Set();
for (const binding of crossType.referenceContract.bindings) {
  assert.ok(crossType.referenceContract.expectedClause.includes(binding.label), `Reference label was changed: ${binding.label}`);
  assert.ok(
    crossType.referenceContract.expectedClause.includes(binding.description),
    `Human description was changed: ${binding.referenceId}`,
  );
  for (const dimension of binding.controlledDimensions) {
    assert.ok(!controlledDimensions.has(dimension), `Multiple winning references control ${dimension}`);
    controlledDimensions.add(dimension);
  }
}
assert.ok(!/上传顺序|第一张|第二张/u.test(crossType.referenceContract.expectedClause), "Reference authority depends on upload order");

const caseIds = crossType.compilerCases.map((item) => item.id);
assert.equal(new Set(caseIds).size, caseIds.length, "Compiler fixture IDs must be unique");
for (const compilerCase of crossType.compilerCases) {
  assert.ok(compilerCase.expectedPrompt.includes(compilerCase.name), `${compilerCase.id} lost its Asset name`);
  for (const fact of compilerCase.requiredFacts ?? []) {
    assert.ok(compilerCase.expectedPrompt.includes(fact), `${compilerCase.id} lost required fact: ${fact}`);
  }
  assert.ok(!compilerCase.expectedPrompt.includes("参考图"), `${compilerCase.id} invented reference wording`);
}

const sceneCase = crossType.compilerCases.find((item) => item.assetType === "scene");
assert.ok(sceneCase.expectedPrompt.includes("无人"), "Scene prompt must exclude people");
assert.ok(sceneCase.expectedPrompt.includes("纵深中轴"), "Scene prompt must preserve spatial identity");

const propCases = crossType.compilerCases.filter((item) => item.assetType === "prop");
assert.equal(propCases.length, 2, "Expected base and Derived Prop cases");
for (const propCase of propCases) {
  assert.ok(/无人物、无手部、无人持有/u.test(propCase.expectedPrompt), `${propCase.id} broke prop isolation`);
}
const derivedProp = propCases.find((item) => item.parentName);
assert.ok(derivedProp.expectedPrompt.includes(derivedProp.parentName), "Derived Prop lost parent identity");
for (const anchor of derivedProp.requiredImmutable) {
  assert.ok(derivedProp.expectedPrompt.includes(anchor), `Derived Prop lost immutable anchor: ${anchor}`);
}
for (const change of derivedProp.storyChange) {
  assert.ok(derivedProp.expectedPrompt.includes(change), `Derived Prop lost story-changing state: ${change}`);
}

console.log(
  `Validated ${briefs.length} differentiated Asset Briefs, ${Object.keys(prompts).length} character prompts, ` +
    `${crossType.compilerCases.length} cross-type compiler cases, and ${crossType.referenceContract.bindings.length} reference bindings.`,
);
