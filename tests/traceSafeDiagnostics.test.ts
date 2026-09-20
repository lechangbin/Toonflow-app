import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DIAGNOSTIC_AUDIENCES,
  DIAGNOSTIC_FAILURE_CLASSES,
  formatTraceSafeLog,
  inspectTraceSafePayload,
  projectTraceSafeDiagnostic,
} from "../src/diagnostics/traceSafeDiagnostics";

test("versioned negative fixtures remain fail-closed with their declared violation codes", () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), "data", "eval", "trace-safe-diagnostics-v1", "negative-fixtures.json"),
      "utf8",
    ),
  ) as {
    schemaVersion: string;
    taxonomyVersion: string;
    cases: Array<{
      id: string;
      allowedTopLevelKeys: string[];
      input: Record<string, unknown>;
      expectedCodes: string[];
    }>;
  };
  assert.equal(fixture.schemaVersion, "toonflow.trace-safe-negative-fixtures.v1");
  assert.equal(fixture.taxonomyVersion, "toonflow.trace-safe-diagnostic.v1");
  assert.equal(new Set(fixture.cases.map((entry) => entry.id)).size, fixture.cases.length);
  for (const entry of fixture.cases) {
    const inspected = inspectTraceSafePayload(entry.input, { allowedTopLevelKeys: entry.allowedTopLevelKeys });
    assert.equal(inspected.ok, false, entry.id);
    if (inspected.ok) continue;
    assert.deepEqual(
      [...new Set(inspected.violations.map((violation) => violation.code))].sort(),
      [...entry.expectedCodes].sort(),
      entry.id,
    );
  }
});

test("legacy logger projection never emits unstructured source content", () => {
  const ordinary = "image request started model=image-v1";
  assert.equal(formatTraceSafeLog(ordinary), "[diagnostic-rejected:unstructuredLog]");
  assert.equal(formatTraceSafeLog(ordinary).includes(ordinary), false);
  assert.equal(formatTraceSafeLog("C:\\private\\prompt.json").includes("prompt.json"), false);
  assert.equal(formatTraceSafeLog('{"prompt":"private output"}').includes("private output"), false);
  const secret = "Bearer sk-secret-123456";
  const rejectedSecret = formatTraceSafeLog(secret);
  assert.equal(rejectedSecret, "[diagnostic-rejected:unstructuredLog]");
  assert.equal(rejectedSecret.includes(secret), false);

  const rejectedObject = formatTraceSafeLog({ response: { signedUrl: "https://x.invalid?a=1" } });
  assert.equal(rejectedObject, "[diagnostic-rejected:unstructuredLog]");
  assert.equal(rejectedObject.includes("signedUrl"), false);

  const hostile = Object.defineProperty({}, "response", {
    enumerable: true,
    get: () => {
      throw new Error("getter boom");
    },
  });
  assert.doesNotThrow(() => formatTraceSafeLog(hostile));
  assert.equal(formatTraceSafeLog(hostile), "[diagnostic-rejected:unstructuredLog]");
});

test("taxonomy exposes every stable failure class with stage, kind, and certainty", () => {
  assert.deepEqual(DIAGNOSTIC_FAILURE_CLASSES, [
    "Extraction",
    "Decision",
    "Tool",
    "Context",
    "Vendor",
    "Artifact",
  ]);

  for (const failureClass of DIAGNOSTIC_FAILURE_CLASSES) {
    const projected = projectTraceSafeDiagnostic(
      {
        failureClass,
        stage: "evaluation",
        kind: "contractRejected",
        severity: "error",
        certainty: "known-no-effect",
        expectedness: "unexpected",
        retryDisposition: "never",
        attributes: { operation: "golden-eval", count: 1, retryable: false },
      },
      "trace",
    );
    assert.equal(projected.ok, true);
    if (!projected.ok) continue;
    assert.deepEqual(
      {
        failureClass: projected.value.failureClass,
        stage: projected.value.stage,
        kind: projected.value.kind,
        certainty: projected.value.certainty,
      },
      { failureClass, stage: "evaluation", kind: "contractRejected", certainty: "known-no-effect" },
    );
  }
});

test("one projection interface serves Trace, ToolReceipt, evaluation, and UI safely", () => {
  const inner = new Error("local timeout");
  inner.name = "TransportTimeout";
  const outer = new Error("vendor call failed", { cause: inner });
  outer.name = "VendorCallError";

  for (const audience of DIAGNOSTIC_AUDIENCES) {
    const projected = projectTraceSafeDiagnostic(
      {
        failureClass: "Vendor",
        stage: "vendor-request",
        kind: "timeout",
        severity: "error",
        certainty: "unknown-effect",
        expectedness: "unexpected",
        retryDisposition: "reconcile-first",
        attributes: {
          attempt: 2,
          elapsedMs: 1200,
          httpStatus: 504,
          transportCode: "ETIMEDOUT",
          providerRequestId: "request-123",
          retryable: false,
        },
        cause: outer,
      },
      audience,
    );
    assert.equal(projected.ok, true);
    if (!projected.ok) continue;
    assert.equal(projected.value.schemaVersion, "toonflow.trace-safe-diagnostic.v1");
    assert.equal(projected.value.audience, audience);
    assert.equal(JSON.stringify(projected.value).includes("vendor call failed"), false);
    assert.equal(JSON.stringify(projected.value).includes("local timeout"), false);
  }
});

test("all four audiences fail closed for the same malicious diagnostic", () => {
  const secret = "sk_malicious_secret_value";
  for (const audience of ["trace", "toolReceipt", "evaluation", "ui"] as const) {
    const projected = projectTraceSafeDiagnostic(
      {
        failureClass: "Vendor",
        stage: "vendor-request",
        kind: "providerRejected",
        severity: "error",
        certainty: "known-no-effect",
        expectedness: "unexpected",
        retryDisposition: "never",
        attributes: { operation: secret },
      },
      audience,
    );
    assert.equal(projected.ok, false, audience);
    assert.equal(JSON.stringify(projected).includes(secret), false, audience);
  }
});

test("audience is runtime-validated instead of relying on TypeScript", () => {
  const projected = projectTraceSafeDiagnostic(
    {
      failureClass: "Tool",
      stage: "tool-call",
      kind: "executionFailed",
      severity: "error",
      certainty: "known-no-effect",
      expectedness: "unexpected",
      retryDisposition: "never",
    },
    "not-an-audience" as never,
  );
  assert.equal(projected.ok, false);
  if (!projected.ok) {
    assert.ok(projected.violations.some((entry) => entry.path === "diagnostic.audience"));
  }
});

test("diagnostic projection rejects undeclared top-level fields without echoing their values", () => {
  const secret = "sk_top_level_secret_value";
  const projected = projectTraceSafeDiagnostic(
    {
      failureClass: "Vendor",
      stage: "vendor-request",
      kind: "providerRejected",
      severity: "error",
      certainty: "known-no-effect",
      expectedness: "unexpected",
      retryDisposition: "never",
      rawProviderResponse: { token: secret },
    } as never,
    "trace",
  );
  assert.equal(projected.ok, false);
  if (!projected.ok) assert.ok(projected.violations.some((entry) => entry.code === "unknownField"));
  assert.equal(JSON.stringify(projected).includes(secret), false);
});

test("payload gate rejects nested secrets, arrays, signed URLs, raw payloads, hidden reasoning, and binary", () => {
  const secret = "sk-live-SECRET123456";
  const signedUrl = "https://vendor.invalid/file.png?X-Amz-Signature=secret&X-Amz-Expires=60";
  const inspected = inspectTraceSafePayload(
    {
      evidence: {
        nested: [{ apiKey: secret }, { harmlessName: "A".repeat(120) }],
        signedUrl,
        rawProviderResponse: { status: "failed" },
        hiddenReasoning: "private chain",
        binary: Buffer.from("provider-bytes"),
        authorizationText: `Bearer ${secret}`,
      },
      unexpectedTopLevel: "safe-looking-but-undeclared",
    },
    { allowedTopLevelKeys: ["evidence"] },
  );

  assert.equal(inspected.ok, false);
  if (inspected.ok) return;
  const codes = new Set(inspected.violations.map((entry) => entry.code));
  assert.deepEqual(codes, new Set([
    "base64Payload",
    "binaryPayload",
    "hiddenReasoning",
    "rawProviderPayload",
    "secretValue",
    "sensitiveKey",
    "signedUrl",
    "unknownField",
  ]));
  const serialized = JSON.stringify(inspected);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(signedUrl), false);
  assert.equal(serialized.includes("apiKey"), false);
  assert.equal(serialized.includes("unexpectedTopLevel"), false);
});

test("diagnostic projection rejects unknown Vendor fields and unsafe Error cause chains without echoing them", () => {
  const nested = new Error("Bearer sk-secret-123456");
  nested.name = "UnsafeVendorError";
  const projected = projectTraceSafeDiagnostic(
    {
      failureClass: "Vendor",
      stage: "vendor-poll",
      kind: "providerRejected",
      severity: "error",
      certainty: "unknown-effect",
      expectedness: "unexpected",
      retryDisposition: "reconcile-first",
      attributes: {
        attempt: 1,
        vendorDebugBlob: { response: "raw" },
      } as never,
      cause: new Error("outer", { cause: nested }),
    },
    "evaluation",
  );

  assert.equal(projected.ok, false);
  if (projected.ok) return;
  assert.ok(projected.violations.some((entry) => entry.code === "unknownField"));
  assert.ok(projected.violations.some((entry) => entry.code === "secretValue"));
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes("vendorDebugBlob"), false);
  assert.equal(serialized.includes("sk-secret-123456"), false);
});

test("every exported identifier and numeric attribute is contract-checked", () => {
  const secretName = new Error("safe local message");
  secretName.name = "npm_abcdefghijklmnopqrstuvwxyz123456";
  const unsafe = projectTraceSafeDiagnostic(
    {
      failureClass: "Vendor",
      stage: "vendor-request",
      kind: "timeout",
      severity: "error",
      certainty: "unknown-effect",
      expectedness: "unexpected",
      retryDisposition: "reconcile-first",
      attributes: { attempt: Number.NaN, elapsedMs: -1, httpStatus: 999 },
      cause: secretName,
    },
    "trace",
  );
  assert.equal(unsafe.ok, false);
  if (!unsafe.ok) {
    assert.ok(unsafe.violations.some((entry) => entry.code === "secretValue"));
    assert.ok(unsafe.violations.filter((entry) => entry.code === "invalidContract").length >= 3);
    assert.equal(JSON.stringify(unsafe).includes(secretName.name), false);
  }

  const drift = projectTraceSafeDiagnostic(
    {
      failureClass: "Tool",
      stage: "new-valid-looking-stage",
      kind: "newValidLookingKind",
      severity: "error",
      certainty: "known-no-effect",
      expectedness: "unexpected",
      retryDisposition: "never",
    },
    "toolReceipt",
  );
  assert.equal(drift.ok, false);
  if (!drift.ok) assert.ok(drift.violations.every((entry) => entry.code === "invalidContract"));
});

test("clean exception chains retain bounded error kinds but never messages or stacks", () => {
  const third = new Error("database details");
  third.name = "PersistenceError";
  const second = new Error("tool details", { cause: third });
  second.name = "ToolExecutionError";
  const first = new Error("top details", { cause: second });
  first.name = "AgentRunError";

  const projected = projectTraceSafeDiagnostic(
    {
      failureClass: "Tool",
      stage: "tool-call",
      kind: "executionFailed",
      severity: "error",
      certainty: "known-no-effect",
      expectedness: "unexpected",
      retryDisposition: "safe-retry",
      cause: first,
    },
    "trace",
  );
  assert.equal(projected.ok, true);
  if (!projected.ok) return;
  assert.deepEqual(projected.value.causes, [
    { name: "AgentRunError" },
    { name: "ToolExecutionError" },
    { name: "PersistenceError" },
  ]);
  const serialized = JSON.stringify(projected.value);
  assert.equal(serialized.includes("details"), false);
  assert.equal(serialized.includes("stack"), false);
});

test("payload gate rejects cycles, excessive depth, and unknown taxonomy values deterministically", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  let deep: Record<string, unknown> = {};
  const root = deep;
  for (let index = 0; index < 20; index += 1) {
    const next: Record<string, unknown> = {};
    deep.next = next;
    deep = next;
  }
  const inspected = inspectTraceSafePayload({ circular, root }, { allowedTopLevelKeys: ["circular", "root"] });
  assert.equal(inspected.ok, false);
  if (!inspected.ok) {
    assert.deepEqual(
      new Set(inspected.violations.map((entry) => entry.code)),
      new Set(["circularReference", "payloadTooDeep"]),
    );
  }

  const invalid = projectTraceSafeDiagnostic(
    {
      failureClass: "Network" as never,
      stage: "bad stage with spaces",
      kind: "bad kind",
      severity: "loud" as never,
      certainty: "maybe" as never,
      expectedness: "sometimes" as never,
      retryDisposition: "blind-retry" as never,
    },
    "trace",
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.ok(invalid.violations.every((entry) => entry.code === "invalidContract"));
});
