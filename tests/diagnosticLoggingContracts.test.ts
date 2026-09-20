import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("Vendor adapters do not log credentials, signing material, signed URLs, or raw Provider objects", () => {
  for (const relativePath of ["data/vendor/volcengine.ts", "data/vendor/volcengineSd2.ts"]) {
    const content = source(relativePath);
    for (const forbidden of [
      /logger\(vendor\.inputValues\.(?:ak|sk)/u,
      /logger\((?:createResponse|response|provider)\)/u,
      /logger\([^\n]*(?:CanonicalRequest|StringToSign|预签名URL)/u,
      /logger\([^\n]*JSON\.stringify\(task/u,
      /throw new Error\([^\n]*errorText/u,
    ]) {
      assert.doesNotMatch(content, forbidden, `${relativePath} contains a legacy diagnostic leak`);
    }
  }
});

test("VM and process-level logger paths use stable safe projections", () => {
  const vm = source("src/utils/vm.ts");
  assert.match(vm, /formatTraceSafeLog\(logstring\)/u);
  assert.doesNotMatch(vm, /JSON\.stringify\(logstring\)/u);

  const processErrors = source("src/err.ts");
  assert.match(processErrors, /formatTraceSafeLog/u);
  assert.doesNotMatch(processErrors, /serializeError|\.stack|\.message|console\.error\([^)]*,\s*promise/iu);

  for (const relativePath of [
    "src/routes/setting/vendorConfig/modelTest.ts",
    "src/routes/setting/vendorConfig/modelTest/imageTest.ts",
    "src/routes/setting/vendorConfig/modelTest/textTest.ts",
    "src/routes/setting/vendorConfig/modelTest/videoTest.ts",
  ]) {
    const modelTest = source(relativePath);
    assert.doesNotMatch(modelTest, /console\.(?:log|error)|u\.error\([^)]*\)\.message/u);
    assert.match(modelTest, /error\("模型测试失败"\)/u);
  }
});

test("detached jobs and Agent routes never log or return caught error content", () => {
  for (const relativePath of [
    "src/routes/production/workbench/generateVideo.ts",
    "src/routes/production/workbench/batchGenerateVideo.ts",
    "src/routes/production/assets/batchGenerateAssetsImage.ts",
    "src/socket/routes/scriptAgent.ts",
    "src/socket/routes/productionAgent.ts",
  ]) {
    const content = source(relativePath);
    assert.doesNotMatch(content, /console\.error\([^\n]*,\s*(?:error|err|u\.error)/u, relativePath);
    assert.doesNotMatch(content, /msg\.error\(u\.error|u\.error\([^)]*\)\.message/u, relativePath);
  }

  const extraction = source("src/script/baseAssetExtraction.ts");
  assert.doesNotMatch(extraction, /JSON\.stringify\(entry\)/u);
  assert.match(extraction, /log:\s*\(\)\s*=>\s*undefined/u);
});

test("global and best-effort failure handlers emit classifications instead of caught values", () => {
  const app = source("src/app.ts");
  assert.match(app, /formatTraceSafeLog\(err\)/u);
  assert.doesNotMatch(app, /console\.error\(err\)|send\(err\)|res\.locals\.error/u);

  for (const relativePath of [
    "src/database/readiness.ts",
    "src/assets/assetReferenceMedia.ts",
    "src/routes/production/saveFlowData.ts",
    "src/routes/setting/agentDeploy/agentSetKey.ts",
  ]) {
    const content = source(relativePath);
    assert.doesNotMatch(content, /console\.(?:error|warn)\([^\n]*,\s*(?:error|err|mediaPath)/u, relativePath);
  }

  const agentTools = source("src/agents/productionAgent/tools.ts");
  assert.doesNotMatch(agentTools, /appendText\([^\n]*(?:JSON\.stringify\(res|u\.error\([^)]*\)\.message)/u);
});

test("image generation and AI analysis routes do not persist or return Vendor messages", () => {
  for (const relativePath of [
    "src/routes/production/editImage/generateFlowImage.ts",
    "src/routes/production/storyboard/batchGenerateImage.ts",
    "src/routes/script/getAiRegex.ts",
  ]) {
    const content = source(relativePath);
    assert.doesNotMatch(content, /u\.error\([^)]*\)\.message/u, relativePath);
    assert.doesNotMatch(content, /taskRecord\(-1,\s*u\.error|reason:\s*u\.error/u, relativePath);
  }

  const volcengine = source("data/vendor/volcengine.ts");
  assert.doesNotMatch(volcengine, /item\.error\.(?:message|code)/u);
});
