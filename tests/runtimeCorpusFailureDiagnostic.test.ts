import assert from "node:assert/strict";
import test from "node:test";

import { classifyRuntimeCorpusFailure } from "../src/eval/runtimeCorpusFailureDiagnostic";

test("T11 failure diagnostic keeps only allowlisted fields, never exception text", () => {
  const error = Object.assign(new Error("apiKey=sk-private-do-not-print"), {
    response: { status: 429 }, code: "secret-provider-code",
  });
  error.stack = "Error: apiKey=sk-private-do-not-print\n"
    + " at Object.record (C:\\work\\src\\eval\\evaluationRun.ts:219:17)";
  const diagnostic = classifyRuntimeCorpusFailure(error);
  assert.deepEqual(diagnostic, { errorName: "Error", category: "provider-http",
    httpStatus: 429, networkCode: null, sourceSite: "src/eval/evaluationRun.ts:219:17" });
  assert.doesNotMatch(JSON.stringify(diagnostic), /sk-private|secret-provider-code/u);
  assert.equal(classifyRuntimeCorpusFailure({ message: "password=hidden" }).category,
    "unclassified");
  assert.equal(classifyRuntimeCorpusFailure(new Error(
    "Evaluation case lacks valid Agent Run evidence")).category, "evaluation-evidence");
});

test("T11 nonterminal Runtime diagnostics expose only fixed vocabulary", () => {
  const error = Object.assign(new Error("Evaluation case has no terminal production Agent Run"), {
    name: "EvaluationCaseNonterminalRunError", runStatus: "waiting",
    attentionReason: "model-call-outcome-unknown",
    diagnostic: { failureClass: "Vendor", stage: "vendor-request", kind: "httpError",
      certainty: "unknown-effect", retryDisposition: "reconcile-first" },
  });
  const accepted = classifyRuntimeCorpusFailure(error);
  assert.deepEqual(accepted.runtime, { runStatus: "waiting",
    attentionReason: "model-call-outcome-unknown", failureClass: "Vendor",
    stage: "vendor-request", kind: "httpError", certainty: "unknown-effect",
    retryDisposition: "reconcile-first" });
  error.attentionReason = "apiKey=sk-private-do-not-print";
  error.diagnostic.kind = "response=sk-private-do-not-print";
  const rejected = classifyRuntimeCorpusFailure(error);
  assert.equal(rejected.runtime?.attentionReason, null);
  assert.equal(rejected.runtime?.kind, null);
  assert.doesNotMatch(JSON.stringify(rejected), /sk-private/u);
});
