import { createHash } from "node:crypto";
import fs from "node:fs";

import { inspectTraceSafePayload } from "../diagnostics/traceSafeDiagnostics";
import { executeGoldenScenario, GOLDEN_SCENARIO_IDS } from "./goldenEvalScenarios";

export const GOLDEN_EVAL_RUNNER_VERSION = "golden-eval-runner@1.0.0";

export type GoldenEvalPartition = "development" | "holdout" | "incident-regression";

export interface GoldenEvalManifestCase {
  id: string;
  partition: GoldenEvalPartition;
  scenario: string;
  title: string;
  fixtureSources: string[];
  groundTruth: string[];
  hardGates: Array<{ id: string; statement: string }>;
  requiredArtifacts: string[];
  expectedFailureClass: { primary: string; stage: string; kind: string };
  rubric: {
    focus: string;
    anchors: Array<{ score: number; description: string }>;
  };
}

export interface GoldenEvalManifest {
  schemaVersion: string;
  suiteId: string;
  runnerVersion: string;
  baselineRevision: string;
  executionTier: string;
  qualityRubricVersion: string;
  cases: GoldenEvalManifestCase[];
}

interface HardGateResult {
  id: string;
  statement: string;
  passed: boolean;
}

interface GoldenEvalCaseResult {
  id: string;
  partition: GoldenEvalPartition;
  scenario: string;
  passed: boolean;
  expectedFailureClass: GoldenEvalManifestCase["expectedFailureClass"];
  hardGates: HardGateResult[];
  qualityReview: {
    rubricVersion: string;
    state: "pending";
    evaluator: null;
    score: null;
    evidence: string[];
    reason: string;
  };
  artifacts: Record<string, unknown>;
  failures: Array<{
    primary: "Artifact";
    stage: "evaluation";
    kind: "hardGateFailed" | "evidenceIncomplete" | "runnerError" | "redactionFailed";
    gateId?: string;
  }>;
}

export interface GoldenEvalResult {
  schemaVersion: "toonflow.golden-eval-result.v1";
  suiteId: string;
  runId: string;
  runnerVersion: string;
  manifestHash: string;
  baselineRevision: string;
  executionTier: string;
  commands: string[];
  environment: {
    temporarySqlite: true;
    modelAdapter: "deterministic-fake";
    vendorAdapter: "deterministic-fake";
    paidProviderCalls: 0;
  };
  summary: {
    defined: number;
    executed: number;
    hardGate: { passed: number; failed: number; denominator: number };
    executions: { valid: number; invalid: number; missing: number; denominator: number };
    quality: { reviewed: number; pending: number; denominator: number; scoreCounts: { "0": number; "1": number; "2": number } };
    partitions: Record<GoldenEvalPartition, { passed: number; failed: number; denominator: number }>;
    failuresByTaxonomy: Record<string, number>;
  };
  cases: GoldenEvalCaseResult[];
}

export function summarizeGoldenExecutionCounts(
  results: ReadonlyArray<{ failures: ReadonlyArray<{ kind: string }> }>,
  defined: number,
): { valid: number; invalid: number; missing: number; denominator: number } {
  const invalidKinds = new Set(["runnerError", "evidenceIncomplete", "redactionFailed"]);
  const invalid = results.filter((entry) => entry.failures.some((failure) => invalidKinds.has(failure.kind))).length;
  return { valid: results.length - invalid, invalid, missing: Math.max(0, defined - results.length), denominator: defined };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyStrings(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`${label} must be a non-empty string array`);
  }
}

export function loadGoldenEvalManifest(manifestPath: string): GoldenEvalManifest {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as GoldenEvalManifest;
}

export function validateGoldenEvalManifest(value: unknown): GoldenEvalManifest {
  if (!isRecord(value)) throw new Error("Golden Eval manifest must be an object");
  if (value.schemaVersion !== "toonflow.golden-eval-manifest.v1") throw new Error("Unsupported Golden Eval schemaVersion");
  if (value.runnerVersion !== GOLDEN_EVAL_RUNNER_VERSION) throw new Error("Manifest runnerVersion does not match Runner");
  for (const field of ["suiteId", "baselineRevision", "executionTier", "qualityRubricVersion"] as const) {
    if (typeof value[field] !== "string" || !value[field].trim()) throw new Error(`${field} is required`);
  }
  if (!Array.isArray(value.cases) || value.cases.length !== 18) throw new Error("Golden Eval requires exactly 18 cases");

  const cases = value.cases as unknown[];
  const ids = new Set<string>();
  const partitions: Record<GoldenEvalPartition, number> = { development: 0, holdout: 0, "incident-regression": 0 };
  const scenarioIds = new Set(GOLDEN_SCENARIO_IDS);
  for (const [index, raw] of cases.entries()) {
    if (!isRecord(raw)) throw new Error(`cases[${index}] must be an object`);
    if (typeof raw.id !== "string" || !/^(DEV|HOLD|INC)-[A-Z]+-\d{3}$/.test(raw.id)) {
      throw new Error(`cases[${index}].id is not stable`);
    }
    if (ids.has(raw.id)) throw new Error(`Duplicate Golden Eval case ID: ${raw.id}`);
    ids.add(raw.id);
    if (!(raw.partition === "development" || raw.partition === "holdout" || raw.partition === "incident-regression")) {
      throw new Error(`${raw.id}.partition is invalid`);
    }
    partitions[raw.partition] += 1;
    if (typeof raw.scenario !== "string" || !scenarioIds.has(raw.scenario)) throw new Error(`${raw.id}.scenario is unknown`);
    if (typeof raw.title !== "string" || !raw.title.trim()) throw new Error(`${raw.id}.title is required`);
    requireNonEmptyStrings(raw.fixtureSources, `${raw.id}.fixtureSources`);
    requireNonEmptyStrings(raw.groundTruth, `${raw.id}.groundTruth`);
    requireNonEmptyStrings(raw.requiredArtifacts, `${raw.id}.requiredArtifacts`);
    if (!Array.isArray(raw.hardGates) || raw.hardGates.length === 0) throw new Error(`${raw.id}.hardGates is required`);
    const gateIds = new Set<string>();
    for (const gate of raw.hardGates) {
      if (!isRecord(gate) || typeof gate.id !== "string" || !gate.id.trim() || typeof gate.statement !== "string" || !gate.statement.trim()) {
        throw new Error(`${raw.id}.hardGates contains an invalid gate`);
      }
      if (gateIds.has(gate.id)) throw new Error(`${raw.id}.hardGates contains duplicate id ${gate.id}`);
      gateIds.add(gate.id);
    }
    if (!isRecord(raw.expectedFailureClass)) throw new Error(`${raw.id}.expectedFailureClass is required`);
    for (const field of ["primary", "stage", "kind"] as const) {
      if (typeof raw.expectedFailureClass[field] !== "string" || !raw.expectedFailureClass[field]) {
        throw new Error(`${raw.id}.expectedFailureClass.${field} is required`);
      }
    }
    if (!isRecord(raw.rubric) || typeof raw.rubric.focus !== "string" || !Array.isArray(raw.rubric.anchors)) {
      throw new Error(`${raw.id}.rubric is invalid`);
    }
    const scores = raw.rubric.anchors.map((anchor) => (isRecord(anchor) ? anchor.score : undefined));
    if (scores.length !== 3 || scores.some((score, scoreIndex) => score !== scoreIndex)) {
      throw new Error(`${raw.id}.rubric must define ordered 0/1/2 anchors`);
    }
    if (raw.rubric.anchors.some((anchor) => !isRecord(anchor) || typeof anchor.description !== "string" || !anchor.description.trim())) {
      throw new Error(`${raw.id}.rubric anchors require descriptions`);
    }
  }
  if (partitions.development !== 12 || partitions.holdout !== 3 || partitions["incident-regression"] !== 3) {
    throw new Error("Golden Eval partition contract is 12 development, 3 holdout, and 3 incident-regression");
  }
  return value as unknown as GoldenEvalManifest;
}

export function hashGoldenEvalManifest(content: string | Buffer): string {
  const normalized = content.toString().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function manifestHash(manifestPath: string): string {
  return hashGoldenEvalManifest(fs.readFileSync(manifestPath));
}

function safeErrorKind(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  // A Runner failure is itself evidence, but its message can contain a SQLite
  // path, fixture body, provider response, or credential. Persist only the
  // stable error class; detailed diagnostics stay in the local test process.
  return error.name.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 80) || "Error";
}

export function findUndeclaredGoldenArtifacts(
  artifacts: Record<string, unknown>,
  declaredArtifactNames: readonly string[],
): string[] {
  const inspected = inspectTraceSafePayload(artifacts, { allowedTopLevelKeys: declaredArtifactNames });
  if (inspected.ok) return [];
  return inspected.violations
    .filter((entry) => entry.code === "unknownField")
    .map((entry) => entry.path.replace(/^payload\.\[key:(\d+)\]$/u, "artifacts.[undeclared-key:$1]"))
    .sort();
}

const GOLDEN_EVAL_ALLOWED_NESTED_ARTIFACT_KEYS = [
  "assetId",
  "attempt",
  "baseName",
  "digest",
  "elapsedMs",
  "errorKind",
  "filePath",
  "id",
  "kind",
  "name",
  "prompt",
  "providerRequestId",
  "requestId",
  "scriptId",
  "stage",
  "state",
  "transportCode",
  "type",
] as const;

/**
 * Eval evidence is an export boundary. Reject sensitive shapes before JSON
 * persistence; never attempt lossy best-effort masking that could make a case
 * look complete while silently dropping its evidence.
 */
export function findSensitiveGoldenArtifacts(value: unknown, path = "artifacts"): string[] {
  if (!isRecord(value)) return [path];
  const inspected = inspectTraceSafePayload(value, {
    allowedTopLevelKeys: Object.keys(value),
    allowedNestedKeys: GOLDEN_EVAL_ALLOWED_NESTED_ARTIFACT_KEYS,
    nestedNullOnlyKeys: ["prompt", "filePath"],
  });
  if (inspected.ok) return [];
  return inspected.violations
    .filter(
      (entry, _index, entries) =>
        entry.code !== "unknownField" || !entries.some((candidate) => candidate.path === entry.path && candidate !== entry),
    )
    .map((entry) => {
      const structuralPath = entry.path.replace(/^payload/u, path);
      return ["sensitiveKey", "rawProviderPayload", "hiddenReasoning"].includes(entry.code)
        ? structuralPath.replace(/\.\[key:(\d+)\]$/u, ".[sensitive-key:$1]")
        : structuralPath;
    })
    .filter((entry, index, entries) => entries.indexOf(entry) === index)
    .sort();
}

type GoldenCaseFailure = GoldenEvalCaseResult["failures"][number];

export function finalizeGoldenCaseObservation(input: {
  hardGateDefinitions: ReadonlyArray<{ id: string; statement: string }>;
  requiredArtifacts: readonly string[];
  gates: Record<string, boolean>;
  artifacts: Record<string, unknown>;
  runnerError: string | null;
}): {
  hardGates: HardGateResult[];
  artifacts: Record<string, unknown>;
  failures: GoldenCaseFailure[];
} {
  const hardGates: HardGateResult[] = input.hardGateDefinitions.map((gate) => ({
    ...gate,
    passed: input.runnerError === null && input.gates[gate.id] === true,
  }));

  if (input.runnerError !== null) {
    hardGates.push(
      {
        id: "artifact-export-contract",
        statement: "Exported artifacts match the manifest allowlist and contain no credentials, binary/Base64 payloads, signed URLs, raw responses, or hidden reasoning",
        passed: false,
      },
      {
        id: "required-artifacts",
        statement: "Every required artifact is present",
        passed: false,
      },
    );
    return {
      hardGates,
      artifacts: {},
      failures: [{ primary: "Artifact", stage: "evaluation", kind: "runnerError" }],
    };
  }

  const undeclaredArtifactPaths = findUndeclaredGoldenArtifacts(input.artifacts, input.requiredArtifacts);
  const sensitiveArtifactPaths = findSensitiveGoldenArtifacts(input.artifacts);
  const rejectedArtifactPaths = [...new Set([...undeclaredArtifactPaths, ...sensitiveArtifactPaths])].sort();
  const missingArtifacts = input.requiredArtifacts.filter((artifact) => !(artifact in input.artifacts));
  hardGates.push({
    id: "artifact-export-contract",
    statement: "Exported artifacts match the manifest allowlist and contain no credentials, binary/Base64 payloads, signed URLs, raw responses, or hidden reasoning",
    passed: rejectedArtifactPaths.length === 0,
  });
  hardGates.push({
    id: "required-artifacts",
    statement: "Every required artifact is present",
    passed: missingArtifacts.length === 0,
  });

  const failures: GoldenCaseFailure[] = [];
  if (rejectedArtifactPaths.length > 0) {
    failures.push({ primary: "Artifact", stage: "evaluation", kind: "redactionFailed", gateId: "artifact-export-contract" });
  }
  for (const gate of hardGates.filter((entry) => !entry.passed && entry.id !== "required-artifacts")) {
    if (gate.id === "artifact-export-contract") continue;
    failures.push({ primary: "Artifact", stage: "evaluation", kind: "hardGateFailed", gateId: gate.id });
  }
  if (missingArtifacts.length > 0) {
    failures.push({ primary: "Artifact", stage: "evaluation", kind: "evidenceIncomplete", gateId: "required-artifacts" });
  }

  let artifacts = input.artifacts;
  if (rejectedArtifactPaths.length > 0) artifacts = { exportRejectedPaths: rejectedArtifactPaths };
  if (missingArtifacts.length > 0) artifacts = { ...artifacts, missingArtifacts };
  return { hardGates, artifacts, failures };
}

export async function runGoldenEval(input: { manifestPath: string }): Promise<GoldenEvalResult> {
  const manifest = validateGoldenEvalManifest(loadGoldenEvalManifest(input.manifestPath));
  const manifestDirectory = fs.realpathSync.native(input.manifestPath).replace(/[\\/]manifest\.json$/, "");
  const repositoryRoot = manifestDirectory.replace(/[\\/]data[\\/]eval[\\/][^\\/]+$/, "");
  for (const manifestCase of manifest.cases) {
    for (const fixtureSource of manifestCase.fixtureSources) {
      if (!fs.existsSync(`${repositoryRoot}/${fixtureSource}`)) {
        throw new Error(`${manifestCase.id} fixture source does not exist: ${fixtureSource}`);
      }
    }
  }
  const hash = manifestHash(input.manifestPath);
  const results: GoldenEvalCaseResult[] = [];

  for (const manifestCase of manifest.cases) {
    let gates: Record<string, boolean> = {};
    let artifacts: Record<string, unknown> = {};
    let runnerError: string | null = null;
    try {
      const observation = await executeGoldenScenario(manifestCase.id, manifestCase.scenario);
      gates = observation.gates;
      artifacts = observation.artifacts;
    } catch (error) {
      runnerError = safeErrorKind(error);
    }

    const finalized = finalizeGoldenCaseObservation({
      hardGateDefinitions: manifestCase.hardGates,
      requiredArtifacts: manifestCase.requiredArtifacts,
      gates,
      artifacts,
      runnerError,
    });
    const { hardGates, failures } = finalized;
    artifacts = finalized.artifacts;
    results.push({
      id: manifestCase.id,
      partition: manifestCase.partition,
      scenario: manifestCase.scenario,
      passed: hardGates.every((gate) => gate.passed),
      expectedFailureClass: manifestCase.expectedFailureClass,
      hardGates,
      qualityReview: {
        rubricVersion: manifest.qualityRubricVersion,
        state: "pending",
        evaluator: null,
        score: null,
        evidence: manifestCase.requiredArtifacts,
        reason: "T02 records the anchored human rubric but does not fabricate a human score.",
      },
      artifacts,
      failures,
    });
  }

  const partitionSummary = (partition: GoldenEvalPartition) => {
    const entries = results.filter((entry) => entry.partition === partition);
    const passed = entries.filter((entry) => entry.passed).length;
    return { passed, failed: entries.length - passed, denominator: entries.length };
  };
  const failedCases = results.filter((entry) => !entry.passed);
  const failuresByTaxonomy: Record<string, number> = {};
  for (const failure of results.flatMap((entry) => entry.failures)) {
    const key = `${failure.primary}/${failure.stage}/${failure.kind}`;
    failuresByTaxonomy[key] = (failuresByTaxonomy[key] ?? 0) + 1;
  }

  return {
    schemaVersion: "toonflow.golden-eval-result.v1",
    suiteId: manifest.suiteId,
    runId: `${manifest.suiteId}:${hash.slice(0, 12)}:${GOLDEN_EVAL_RUNNER_VERSION}`,
    runnerVersion: GOLDEN_EVAL_RUNNER_VERSION,
    manifestHash: hash,
    baselineRevision: manifest.baselineRevision,
    executionTier: manifest.executionTier,
    commands: ["yarn eval:golden", "yarn test", "yarn lint", "yarn build", "git diff --check"],
    environment: {
      temporarySqlite: true,
      modelAdapter: "deterministic-fake",
      vendorAdapter: "deterministic-fake",
      paidProviderCalls: 0,
    },
    summary: {
      defined: manifest.cases.length,
      executed: results.length,
      hardGate: { passed: results.length - failedCases.length, failed: failedCases.length, denominator: results.length },
      executions: summarizeGoldenExecutionCounts(results, manifest.cases.length),
      quality: { reviewed: 0, pending: results.length, denominator: results.length, scoreCounts: { "0": 0, "1": 0, "2": 0 } },
      partitions: {
        development: partitionSummary("development"),
        holdout: partitionSummary("holdout"),
        "incident-regression": partitionSummary("incident-regression"),
      },
      failuresByTaxonomy,
    },
    cases: results,
  };
}
