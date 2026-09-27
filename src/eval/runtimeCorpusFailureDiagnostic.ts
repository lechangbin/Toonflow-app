/** Only fixed vocabulary and source locations may leave a private evaluation process. */
import { DIAGNOSTIC_FAILURE_CLASSES, DIAGNOSTIC_KINDS,
  DIAGNOSTIC_STAGES } from "@/diagnostics/traceSafeDiagnostics";

const RUN_STATUSES = ["queued", "running", "waiting", "succeeded", "failed",
  "cancelled", "skipped", "missing"] as const;
const ATTENTION_REASONS = ["model-call-outcome-unknown", "agent-checkpoint-corrupt",
  "agent-checkpoint-incompatible"] as const;
const CERTAINTIES = ["known-no-effect", "known-effect", "unknown-effect"] as const;
const RETRY_DISPOSITIONS = ["never", "safe-retry", "deduplicate-first", "reconcile-first"] as const;

function allowlisted(value: unknown, values: readonly string[]): string | null {
  return typeof value === "string" && values.includes(value) ? value : null;
}

export function classifyRuntimeCorpusFailure(error: unknown): {
  errorName: string; category: string; httpStatus: number | null;
  networkCode: string | null; sourceSite: string | null;
  runtime?: { runStatus: string | null; attentionReason: string | null;
    failureClass: string | null; stage: string | null; kind: string | null;
    certainty: string | null; retryDisposition: string | null };
} {
  const observed = error && typeof error === "object" ? error as {
    name?: unknown; message?: unknown; stack?: unknown; code?: unknown;
    response?: { status?: unknown };
    runStatus?: unknown; attentionReason?: unknown;
    diagnostic?: { failureClass?: unknown; stage?: unknown; kind?: unknown;
      certainty?: unknown; retryDisposition?: unknown };
  } : {};
  const errorName = ["Error", "TypeError", "RangeError", "AbortError", "SqliteError",
    "ZodError", "EvaluationCaseNonterminalRunError"].includes(observed.name as string)
    ? observed.name as string : "OtherError";
  const status = observed.response?.status;
  const httpStatus = Number.isInteger(status) && Number(status) >= 100 && Number(status) <= 599
    ? Number(status) : null;
  const networkCode = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND",
    "EAI_AGAIN"].includes(observed.code as string) ? observed.code as string : null;
  const message = typeof observed.message === "string" ? observed.message : "";
  const category = httpStatus !== null ? "provider-http"
    : networkCode !== null ? "network"
      : /^Evaluation (?:case|source Agent Run)/u.test(message) ? "evaluation-evidence"
        : /Runtime revisions|frozen manifest|Source|source audit rows/u.test(message)
          ? "revision-or-source" : "unclassified";
  const stack = typeof observed.stack === "string" ? observed.stack : "";
  const sourceSite = stack.match(/(?:src[\\/](?:eval|agentRuntime)[\\/][A-Za-z0-9._-]+|scripts[\\/]agnesRuntimeCorpusStudy)\.ts:\d+(?::\d+)?/u)?.[0]
    .replaceAll("\\", "/") ?? null;
  const runtime = errorName === "EvaluationCaseNonterminalRunError" ? {
    runStatus: allowlisted(observed.runStatus, RUN_STATUSES),
    attentionReason: allowlisted(observed.attentionReason, ATTENTION_REASONS),
    failureClass: allowlisted(observed.diagnostic?.failureClass, DIAGNOSTIC_FAILURE_CLASSES),
    stage: allowlisted(observed.diagnostic?.stage, DIAGNOSTIC_STAGES),
    kind: allowlisted(observed.diagnostic?.kind, DIAGNOSTIC_KINDS),
    certainty: allowlisted(observed.diagnostic?.certainty, CERTAINTIES),
    retryDisposition: allowlisted(observed.diagnostic?.retryDisposition, RETRY_DISPOSITIONS),
  } : undefined;
  return { errorName, category, httpStatus, networkCode, sourceSite,
    ...(runtime ? { runtime } : {}) };
}
