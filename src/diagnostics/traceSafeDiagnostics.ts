import { isDeepStrictEqual } from "node:util";

export const TRACE_SAFE_DIAGNOSTIC_SCHEMA_VERSION = "toonflow.trace-safe-diagnostic.v1" as const;

export const DIAGNOSTIC_FAILURE_CLASSES = [
  "Extraction",
  "Decision",
  "Tool",
  "Context",
  "Vendor",
  "Artifact",
] as const;

export type DiagnosticFailureClass = (typeof DIAGNOSTIC_FAILURE_CLASSES)[number];
export const DIAGNOSTIC_AUDIENCES = ["trace", "toolReceipt", "evaluation", "ui"] as const;
export type DiagnosticAudience = (typeof DIAGNOSTIC_AUDIENCES)[number];
export type DiagnosticSeverity = "warning" | "error" | "fatal";
export type DiagnosticCertainty = "known-no-effect" | "known-effect" | "unknown-effect";
export type DiagnosticExpectedness = "expected" | "unexpected";
export type DiagnosticRetryDisposition = "never" | "safe-retry" | "deduplicate-first" | "reconcile-first";

export const DIAGNOSTIC_STAGES = [
  "extraction",
  "decision",
  "tool-call",
  "context-build",
  "vendor-request",
  "vendor-poll",
  "image-generation",
  "image-download",
  "artifact-persistence",
  "evaluation",
  "ui-projection",
  "runtime",
] as const;

export const DIAGNOSTIC_KINDS = [
  "analysisFailed",
  "authorizationFailed",
  "contextMissing",
  "contractRejected",
  "downloadFailed",
  "evidenceIncomplete",
  "executionFailed",
  "hardGateFailed",
  "httpError",
  "invalidOutput",
  "noImageData",
  "persistenceFailed",
  "providerRejected",
  "redactionFailed",
  "runnerError",
  "timeout",
  "transport",
] as const;

export type TraceSafeAttributeValue = string | number | boolean;
export type TraceSafeDiagnosticAttributes = Partial<{
  operation: string;
  count: number;
  retryable: boolean;
  attempt: number;
  elapsedMs: number;
  httpStatus: number;
  transportCode: string;
  providerRequestId: string;
  failureReasonHash: string;
}>;

export interface TraceSafeDiagnosticInput {
  failureClass: DiagnosticFailureClass;
  stage: string;
  kind: string;
  severity: DiagnosticSeverity;
  certainty: DiagnosticCertainty;
  expectedness: DiagnosticExpectedness;
  retryDisposition: DiagnosticRetryDisposition;
  attributes?: TraceSafeDiagnosticAttributes;
  cause?: unknown;
}

export interface TraceSafeDiagnostic {
  schemaVersion: typeof TRACE_SAFE_DIAGNOSTIC_SCHEMA_VERSION;
  audience: DiagnosticAudience;
  failureClass: DiagnosticFailureClass;
  stage: string;
  kind: string;
  severity: DiagnosticSeverity;
  certainty: DiagnosticCertainty;
  expectedness: DiagnosticExpectedness;
  retryDisposition: DiagnosticRetryDisposition;
  attributes?: TraceSafeDiagnosticAttributes;
  causes?: Array<{ name: string }>;
}

export type TraceSafeViolationCode =
  | "base64Payload"
  | "binaryPayload"
  | "circularReference"
  | "hiddenReasoning"
  | "invalidContract"
  | "payloadTooDeep"
  | "rawProviderPayload"
  | "secretValue"
  | "sensitiveKey"
  | "signedUrl"
  | "unstructuredLog"
  | "urlPayload"
  | "unknownField";

export interface TraceSafeViolation {
  code: TraceSafeViolationCode;
  /** Structural location only. Source object keys and values are never copied. */
  path: string;
}

export type TraceSafeResult<T> =
  | { ok: true; value: T }
  | { ok: false; violations: TraceSafeViolation[] };

const ALLOWED_ATTRIBUTE_KEYS = new Set<keyof TraceSafeDiagnosticAttributes>([
  "operation",
  "count",
  "retryable",
  "attempt",
  "elapsedMs",
  "httpStatus",
  "transportCode",
  "providerRequestId",
  "failureReasonHash",
]);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/u;
const BASE64_PAYLOAD = /^[A-Za-z0-9+/]{80,}={0,2}$/u;
const BASE64_DATA_URI = /data:[^,\s]*;base64,/iu;
const SIGNED_URL = /https?:\/\/\S+[?&](?:x-amz-signature|x-amz-credential|x-amz-security-token|x-tos-signature|signature|sig|token|key|expires)=/iu;
const ANY_URL = /https?:\/\/\S+/iu;
const SECRET_VALUE = /(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|ak)[-_][A-Za-z0-9_-]{8,}|\b(?:npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b|\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/iu;
const SECRET_ASSIGNMENT = /\b(?:api[-_ ]?key|authorization|cookie|credential|pass(?:word|wd)?|secret|token|session[-_ ]?token|access[-_ ]?token|refresh[-_ ]?token)\s*[:=]\s*["']?[^\s"'&,;]{4,}/iu;
const SENSITIVE_KEY = /(?:api[-_]?key|authorization|cookie|credential|password|secret|session[-_]?token|access[-_]?token|refresh[-_]?token|(?:^|[-_])token(?:$|[-_]))/iu;
const RAW_PROVIDER_KEY = /^(?:raw(?:[-_]?provider)?(?:[-_]?(?:response|request|payload|result|output|body))?|provider(?:[-_]?(?:response|request|payload|result|output|body))|vendor(?:[-_]?(?:response|request|payload|result|output|body))|response|request[-_]?body|response[-_]?body|body|payload)$/iu;
const HIDDEN_REASONING_KEY = /^(?:reasoning|reasoning[-_]?content|hidden[-_]?reasoning|thinking|chain[-_]?of[-_]?thought)$/iu;
const MAX_DEPTH = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addViolation(
  target: TraceSafeViolation[],
  code: TraceSafeViolationCode,
  path: string,
): void {
  if (!target.some((entry) => entry.code === code && entry.path === path)) target.push({ code, path });
}

function safeObjectEntries(
  value: object,
  path: string,
  violations: TraceSafeViolation[],
): Array<[string, unknown]> {
  try {
    return Object.entries(value);
  } catch {
    addViolation(violations, "invalidContract", path);
    return [];
  }
}

function inspectString(value: string, path: string, violations: TraceSafeViolation[]): void {
  const compact = value.replace(/[\t\n\f\r ]/gu, "");
  if (SIGNED_URL.test(value)) addViolation(violations, "signedUrl", path);
  else if (ANY_URL.test(value)) addViolation(violations, "urlPayload", path);
  if (BASE64_DATA_URI.test(value) || BASE64_PAYLOAD.test(compact)) addViolation(violations, "base64Payload", path);
  if (SECRET_VALUE.test(value)) addViolation(violations, "secretValue", path);
  if (SECRET_ASSIGNMENT.test(value)) addViolation(violations, "secretValue", path);
}

/**
 * Checks user-visible text before durable persistence. Public URLs are valid
 * answer content, while credentials, signed URLs and encoded binary payloads
 * remain forbidden. The text itself is never copied into a violation.
 */
export function inspectPersistableText(value: string): TraceSafeResult<string> {
  const violations: TraceSafeViolation[] = [];
  const compact = value.replace(/[\t\n\f\r ]/gu, "");
  if (SIGNED_URL.test(value)) addViolation(violations, "signedUrl", "content");
  if (BASE64_DATA_URI.test(value) || BASE64_PAYLOAD.test(compact)) {
    addViolation(violations, "base64Payload", "content");
  }
  if (SECRET_VALUE.test(value)) addViolation(violations, "secretValue", "content");
  if (SECRET_ASSIGNMENT.test(value)) addViolation(violations, "secretValue", "content");
  return violations.length === 0 ? { ok: true, value } : { ok: false, violations };
}

function inspectValue(
  value: unknown,
  path: string,
  violations: TraceSafeViolation[],
  seen: WeakSet<object>,
  depth: number,
  allowedNestedKeys?: ReadonlySet<string>,
  nestedNullOnlyKeys?: ReadonlySet<string>,
): void {
  if (depth > MAX_DEPTH) {
    addViolation(violations, "payloadTooDeep", path);
    return;
  }
  if (typeof value === "string") {
    inspectString(value, path, violations);
    return;
  }
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    addViolation(violations, "binaryPayload", path);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) {
    addViolation(violations, "circularReference", path);
    return;
  }
  seen.add(value);
  if (value instanceof Error) {
    inspectString(value.message, `${path}.message`, violations);
    inspectValue(value.cause, `${path}.cause`, violations, seen, depth + 1, allowedNestedKeys, nestedNullOnlyKeys);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectValue(entry, `${path}[${index}]`, violations, seen, depth + 1, allowedNestedKeys, nestedNullOnlyKeys),
    );
    return;
  }
  for (const [index, [key, entry]] of safeObjectEntries(value, path, violations).entries()) {
    const structuralPath = `${path}.[key:${index}]`;
    if (HIDDEN_REASONING_KEY.test(key)) {
      addViolation(violations, "hiddenReasoning", structuralPath);
      continue;
    }
    if (RAW_PROVIDER_KEY.test(key)) {
      addViolation(violations, "rawProviderPayload", structuralPath);
      continue;
    }
    if (SENSITIVE_KEY.test(key)) addViolation(violations, "sensitiveKey", structuralPath);
    if (nestedNullOnlyKeys?.has(key) && entry !== null) {
      addViolation(violations, "invalidContract", structuralPath);
      inspectValue(entry, structuralPath, violations, seen, depth + 1, allowedNestedKeys, nestedNullOnlyKeys);
      continue;
    }
    if (allowedNestedKeys && !allowedNestedKeys.has(key)) {
      addViolation(violations, "unknownField", structuralPath);
      inspectValue(entry, structuralPath, violations, seen, depth + 1, allowedNestedKeys, nestedNullOnlyKeys);
      continue;
    }
    inspectValue(entry, structuralPath, violations, seen, depth + 1, allowedNestedKeys, nestedNullOnlyKeys);
  }
}

export function inspectTraceSafePayload(
  value: unknown,
  options: {
    allowedTopLevelKeys: readonly string[];
    allowedNestedKeys?: readonly string[];
    nestedNullOnlyKeys?: readonly string[];
  },
): TraceSafeResult<unknown> {
  const violations: TraceSafeViolation[] = [];
  if (!isRecord(value)) {
    addViolation(violations, "invalidContract", "payload");
  } else {
    const allowed = new Set(options.allowedTopLevelKeys);
    const allowedNested = options.allowedNestedKeys ? new Set(options.allowedNestedKeys) : undefined;
    const nestedNullOnly = options.nestedNullOnlyKeys ? new Set(options.nestedNullOnlyKeys) : undefined;
    for (const [index, [key, entry]] of safeObjectEntries(value, "payload", violations).entries()) {
      const path = `payload.[key:${index}]`;
      if (!allowed.has(key)) {
        addViolation(violations, "unknownField", path);
        continue;
      }
      if (HIDDEN_REASONING_KEY.test(key)) {
        addViolation(violations, "hiddenReasoning", path);
        continue;
      }
      if (RAW_PROVIDER_KEY.test(key)) {
        addViolation(violations, "rawProviderPayload", path);
        continue;
      }
      if (SENSITIVE_KEY.test(key)) addViolation(violations, "sensitiveKey", path);
      inspectValue(entry, path, violations, new WeakSet<object>(), 1, allowedNested, nestedNullOnly);
    }
  }
  violations.sort((left, right) => left.code.localeCompare(right.code) || left.path.localeCompare(right.path));
  return violations.length ? { ok: false, violations } : { ok: true, value };
}

/** Legacy console projection: unstructured source content is never emitted, even when it looks harmless. */
export function formatTraceSafeLog(_value: unknown): string {
  return "[diagnostic-rejected:unstructuredLog]";
}

function validateIdentifier(value: unknown, path: string, violations: TraceSafeViolation[]): value is string {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) {
    addViolation(violations, "invalidContract", path);
    return false;
  }
  const before = violations.length;
  inspectString(value, path, violations);
  return violations.length === before;
}

function inspectAttributes(
  attributes: unknown,
  violations: TraceSafeViolation[],
): TraceSafeDiagnosticAttributes | undefined {
  if (attributes === undefined) return undefined;
  if (!isRecord(attributes)) {
    addViolation(violations, "invalidContract", "diagnostic.attributes");
    return undefined;
  }
  const safe: TraceSafeDiagnosticAttributes = {};
  for (const [index, [key, value]] of safeObjectEntries(attributes, "diagnostic.attributes", violations).entries()) {
    const path = `diagnostic.attributes.[key:${index}]`;
    if (!ALLOWED_ATTRIBUTE_KEYS.has(key as keyof TraceSafeDiagnosticAttributes)) {
      addViolation(violations, "unknownField", path);
      inspectValue(value, path, violations, new WeakSet<object>(), 1);
      continue;
    }
    let valid = false;
    if (key === "retryable") valid = typeof value === "boolean";
    else if (key === "attempt") valid = Number.isInteger(value) && Number(value) >= 1;
    else if (key === "count" || key === "elapsedMs") valid = Number.isInteger(value) && Number(value) >= 0;
    else if (key === "httpStatus") valid = Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599;
    else if (key === "failureReasonHash") valid = typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
    else valid = validateIdentifier(value, path, violations);
    if (!valid) {
      addViolation(violations, "invalidContract", path);
      inspectValue(value, path, violations, new WeakSet<object>(), 1);
      continue;
    }
    (safe as Record<string, TraceSafeAttributeValue>)[key] = value as TraceSafeAttributeValue;
  }
  return safe;
}

function inspectCauseChain(cause: unknown, violations: TraceSafeViolation[]): Array<{ name: string }> | undefined {
  if (cause === undefined) return undefined;
  const causes: Array<{ name: string }> = [];
  const seen = new Set<unknown>();
  let current: unknown = cause;
  for (let depth = 0; current !== undefined && current !== null && depth < 8; depth += 1) {
    if (seen.has(current)) {
      addViolation(violations, "circularReference", `diagnostic.cause[${depth}]`);
      break;
    }
    seen.add(current);
    if (!(current instanceof Error)) {
      addViolation(violations, "invalidContract", `diagnostic.cause[${depth}]`);
      inspectValue(current, `diagnostic.cause[${depth}]`, violations, new WeakSet<object>(), 1);
      break;
    }
    inspectString(current.message, `diagnostic.cause[${depth}].message`, violations);
    const name = validateIdentifier(current.name, `diagnostic.cause[${depth}].name`, violations) ? current.name : "Error";
    causes.push({ name });
    current = current.cause;
  }
  if (current !== undefined && current !== null && causes.length >= 8) {
    addViolation(violations, "payloadTooDeep", "diagnostic.cause[8]");
  }
  return causes.length ? causes : undefined;
}

export function projectTraceSafeDiagnostic(
  input: TraceSafeDiagnosticInput,
  audience: DiagnosticAudience,
): TraceSafeResult<TraceSafeDiagnostic> {
  const violations: TraceSafeViolation[] = [];
  if (!(DIAGNOSTIC_AUDIENCES as readonly unknown[]).includes(audience)) {
    addViolation(violations, "invalidContract", "diagnostic.audience");
  }
  const allowedInputKeys = new Set([
    "failureClass",
    "stage",
    "kind",
    "severity",
    "certainty",
    "expectedness",
    "retryDisposition",
    "attributes",
    "cause",
  ]);
  for (const [index, [key, value]] of safeObjectEntries(input, "diagnostic", violations).entries()) {
    if (allowedInputKeys.has(key)) continue;
    const path = `diagnostic.[key:${index}]`;
    addViolation(violations, "unknownField", path);
    inspectValue(value, path, violations, new WeakSet<object>(), 1);
  }
  if (!(DIAGNOSTIC_FAILURE_CLASSES as readonly unknown[]).includes(input.failureClass)) {
    addViolation(violations, "invalidContract", "diagnostic.failureClass");
  }
  if (!(DIAGNOSTIC_STAGES as readonly unknown[]).includes(input.stage)) {
    addViolation(violations, "invalidContract", "diagnostic.stage");
  }
  validateIdentifier(input.stage, "diagnostic.stage", violations);
  if (!(DIAGNOSTIC_KINDS as readonly unknown[]).includes(input.kind)) {
    addViolation(violations, "invalidContract", "diagnostic.kind");
  }
  validateIdentifier(input.kind, "diagnostic.kind", violations);
  if (!(new Set(["warning", "error", "fatal"])).has(input.severity)) {
    addViolation(violations, "invalidContract", "diagnostic.severity");
  }
  if (!(new Set(["known-no-effect", "known-effect", "unknown-effect"])).has(input.certainty)) {
    addViolation(violations, "invalidContract", "diagnostic.certainty");
  }
  if (!(new Set(["expected", "unexpected"])).has(input.expectedness)) {
    addViolation(violations, "invalidContract", "diagnostic.expectedness");
  }
  if (!(new Set(["never", "safe-retry", "deduplicate-first", "reconcile-first"])).has(input.retryDisposition)) {
    addViolation(violations, "invalidContract", "diagnostic.retryDisposition");
  }
  const attributes = inspectAttributes(input.attributes, violations);
  const causes = inspectCauseChain(input.cause, violations);
  violations.sort((left, right) => left.code.localeCompare(right.code) || left.path.localeCompare(right.path));
  if (violations.length) return { ok: false, violations };
  return {
    ok: true,
    value: {
      schemaVersion: TRACE_SAFE_DIAGNOSTIC_SCHEMA_VERSION,
      audience,
      failureClass: input.failureClass,
      stage: input.stage,
      kind: input.kind,
      severity: input.severity,
      certainty: input.certainty,
      expectedness: input.expectedness,
      retryDisposition: input.retryDisposition,
      ...(attributes && Object.keys(attributes).length ? { attributes } : {}),
      ...(causes ? { causes } : {}),
    },
  };
}

/** Revalidates a persisted diagnostic instead of trusting a TypeScript cast. */
export function validateTraceSafeDiagnostic(
  value: unknown,
  audience: DiagnosticAudience,
): TraceSafeResult<TraceSafeDiagnostic> {
  if (!isRecord(value)) return { ok: false, violations: [{ code: "invalidContract", path: "diagnostic" }] };
  let cause: Error | undefined;
  if (Array.isArray(value.causes)) {
    for (const entry of [...value.causes].reverse()) {
      if (!isRecord(entry) || typeof entry.name !== "string") {
        return { ok: false, violations: [{ code: "invalidContract", path: "diagnostic.causes" }] };
      }
      const next = new Error("");
      next.name = entry.name;
      next.cause = cause;
      cause = next;
    }
  } else if (value.causes !== undefined) {
    return { ok: false, violations: [{ code: "invalidContract", path: "diagnostic.causes" }] };
  }
  const projected = projectTraceSafeDiagnostic(
    {
      failureClass: value.failureClass as DiagnosticFailureClass,
      stage: value.stage as string,
      kind: value.kind as string,
      severity: value.severity as DiagnosticSeverity,
      certainty: value.certainty as DiagnosticCertainty,
      expectedness: value.expectedness as DiagnosticExpectedness,
      retryDisposition: value.retryDisposition as DiagnosticRetryDisposition,
      ...(value.attributes !== undefined ? { attributes: value.attributes as TraceSafeDiagnosticAttributes } : {}),
      ...(cause ? { cause } : {}),
    },
    audience,
  );
  if (!projected.ok) return projected;
  if (!isDeepStrictEqual(projected.value, value)) {
    return { ok: false, violations: [{ code: "invalidContract", path: "diagnostic" }] };
  }
  return projected;
}
