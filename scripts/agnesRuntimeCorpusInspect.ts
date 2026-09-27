/** Offline T11 source/safety summary. Never prints model text or credentials. */
import fs from "node:fs/promises";
import path from "node:path";

import { createEvaluationRunRuntime } from "../src/eval/evaluationRun";
import { inspectRuntimeCorpusCellGates } from "../src/eval/runtimeCorpusGateVerifier";
import { openSanitizedRuntimeCorpusCheckpoint } from "../src/eval/runtimeCorpusCheckpoint";
import { readRuntimeCorpusStudyPlan } from "../src/eval/runtimeCorpusStudyPlan";
import { T11_AGNES_TEXT_POLICY_REVISION } from "../src/eval/runtimeCorpusModelPolicy";

async function main() {
  const directoryArg = process.argv[2];
  if (!directoryArg || !path.isAbsolute(directoryArg)) {
    throw new TypeError("Usage: agnesRuntimeCorpusInspect.ts ABSOLUTE_DATA_DIR");
  }
  const directory = path.resolve(directoryArg);
  const raw = JSON.parse(await fs.readFile(path.join(directory, "study-plan.json"), "utf8")) as
    { body?: { evaluationRunId?: string; manifestHash?: string } };
  const plan = await readRuntimeCorpusStudyPlan({ directory,
    evaluationRunId: raw.body?.evaluationRunId ?? "",
    manifestHash: raw.body?.manifestHash ?? "",
    modelPolicyRevision: T11_AGNES_TEXT_POLICY_REVISION });
  const numbers = (await fs.readdir(directory)).flatMap((name) => {
    const match = /^checkpoint-(\d{4,})\.sqlite$/u.exec(name);
    return match ? [Number(match[1])] : [];
  });
  if (numbers.length === 0) throw new Error("T11 checkpoint is missing");
  const entries = await fs.readdir(directory);
  const unresolvedCells = [];
  for (const entry of entries.filter((name) => /^inflight-[a-f0-9]{64}\.json$/u.test(name))) {
    if (entries.includes(entry.replace(/^inflight-/u, "completed-"))) continue;
    const marker = JSON.parse(await fs.readFile(path.join(directory, entry), "utf8")) as
      { cellId?: string };
    unresolvedCells.push(marker.cellId ?? "invalid-marker");
  }
  const sequence = Math.max(...numbers);
  const opened = await openSanitizedRuntimeCorpusCheckpoint(path.join(directory,
    `checkpoint-${String(sequence).padStart(4, "0")}.sqlite`));
  try {
    const work = async <T>(operation: (database: typeof opened.db) => Promise<T> | T) =>
      operation(opened.db);
    const evaluation = createEvaluationRunRuntime({ work, now: () => 0, createId: () => "" });
    const frozen = await evaluation.inspect(plan.evaluationRunId);
    if (frozen.manifestHash !== plan.manifestHash || frozen.recorded !== sequence) {
      throw new Error("T11 checkpoint source ledger differs from the study plan");
    }
    const cells = [];
    for (const cell of frozen.cases) {
      const gate = await inspectRuntimeCorpusCellGates({ work, evaluation,
        evaluationRunId: plan.evaluationRunId, variant: cell.variant,
        caseId: cell.caseId, seed: cell.seed,
        readFixture: async (file) => fs.readFile(path.resolve(file)) });
      cells.push({ cellId: `${cell.variant}:${cell.caseId}:${cell.seed}`,
        runStatus: cell.runStatus, safetyState: gate.state,
        violations: gate.violations, checkedReceipts: gate.checkedReceipts });
    }
    console.log(JSON.stringify({ evaluationRunId: plan.evaluationRunId,
      expected: frozen.expected, recorded: frozen.recorded,
      remaining: frozen.missing.length, checkpointSha256: opened.sha256,
      unresolvedCells, pendingFiles: entries.filter((name) => name.endsWith(".pending")).length,
      cells, quality: "unverified", costMicros: null }));
  } finally { await opened.db.destroy(); }
}

main().catch((error: unknown) => {
  console.error("Agnes T11 inspect failed:", error instanceof Error ? error.name : "UnknownError");
  process.exitCode = 1;
});
