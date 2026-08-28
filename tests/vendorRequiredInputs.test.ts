import assert from "node:assert/strict";
import test from "node:test";

import { validateVendorRequiredInputs } from "../src/lib/vendorRuntime";

test("a Vendor cannot be enabled while a required credential is empty", () => {
  assert.throws(
    () =>
      validateVendorRequiredInputs({
        id: "agnes",
        inputs: [
          { key: "apiKey", label: "API Key", type: "password", required: true },
          { key: "baseUrl", label: "API 地址", type: "url", required: true },
        ],
        inputValues: { apiKey: "", baseUrl: "https://apihub.agnes-ai.com" },
        models: [],
      }),
    /Vendor agnes 缺少必填配置：API Key/,
  );
});

test("required Vendor input validation accepts configured credentials", () => {
  assert.doesNotThrow(() =>
    validateVendorRequiredInputs({
      id: "agnes",
      inputs: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
      inputValues: { apiKey: "configured" },
      models: [],
    }),
  );
});
