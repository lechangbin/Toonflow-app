/** Only fixed vocabulary and source locations may leave a private evaluation process. */
export function classifyRuntimeCorpusFailure(error: unknown): {
  errorName: string; category: string; httpStatus: number | null;
  networkCode: string | null; sourceSite: string | null;
} {
  const observed = error && typeof error === "object" ? error as {
    name?: unknown; message?: unknown; stack?: unknown; code?: unknown;
    response?: { status?: unknown };
  } : {};
  const errorName = ["Error", "TypeError", "RangeError", "AbortError", "SqliteError",
    "ZodError"].includes(observed.name as string) ? observed.name as string : "OtherError";
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
  return { errorName, category, httpStatus, networkCode, sourceSite };
}
