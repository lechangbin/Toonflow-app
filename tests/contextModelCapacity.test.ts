import assert from "node:assert/strict";
import test from "node:test";

import { loadVendorRuntime } from "../src/lib/vendorRuntime";

function textVendorSource(capacity: string): string {
  return `const vendor = { id: "capacity-vendor", inputValues: {}, models: [
    { name: "Text", modelName: "text", type: "text", think: false, ${capacity} }
  ] }; exports.vendor = vendor; exports.textRequest = () => ({}); export {};`;
}

test("declared Text Model context capacity is validated before the ContextBuilder can use it", () => {
  assert.equal(loadVendorRuntime(textVendorSource("contextWindowTokens: 8192"))
    .getModel("text").contextWindowTokens, 8192);
  assert.throws(() => loadVendorRuntime(textVendorSource("contextWindowTokens: -1")), /contextWindowTokens 无效/);
  assert.throws(() => loadVendorRuntime(textVendorSource("contextWindowTokens: 3.5")), /contextWindowTokens 无效/);
  assert.equal(loadVendorRuntime(textVendorSource("think: false")).getModel("text").contextWindowTokens,
    undefined, "legacy Model absence remains explicit, not an invented capacity");
});
