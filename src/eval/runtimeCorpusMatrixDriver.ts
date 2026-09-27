import fs from "node:fs/promises";
import path from "node:path";

import type { Knex } from "knex";

import { createEvaluationRunRuntime } from "./evaluationRun";
import { runRuntimeCorpusCell } from "./runtimeCorpusCellRunner";
import { openSanitizedRuntimeCorpusCheckpoint } from "./runtimeCorpusCheckpoint";
import { openRuntimeCorpusExecutionJournal } from "./runtimeCorpusExecutionJournal";
import { planRuntimeCorpusMatrixOrder } from "./runtimeCorpusMatrixOrder";

type Cell = ReturnType<typeof planRuntimeCorpusMatrixOrder>["fullOrder"][number];
type Journal = Awaited<ReturnType<typeof openRuntimeCorpusExecutionJournal>>;
type Evaluation = ReturnType<typeof createEvaluationRunRuntime>;

/** Serial production-cell driver; wiring of actual Runtime, Skill and Model stays injected. */
export async function runRuntimeCorpusMatrix(input: { evaluation: Evaluation;
  evaluationRunId: string; journal: Journal; db: Knex; directory: string;
  checkpoint: { sha256: string; sequence: number };
  secretValues: string[]; maxNewCells?: number;
  preflight(cell: Cell): Promise<void>;
  execute(cell: Cell): Promise<unknown>;
}) {
  if (input.maxNewCells !== undefined
    && (!Number.isSafeInteger(input.maxNewCells) || input.maxNewCells < 1)) {
    throw new TypeError("Runtime matrix maxNewCells must be a positive safe integer");
  }
  await input.journal.assertResumeSafe();
  const frozen = await input.evaluation.inspect(input.evaluationRunId);
  const recorded = frozen.cases.map((cell) => `${cell.variant}:${cell.caseId}:${cell.seed}`);
  const plan = planRuntimeCorpusMatrixOrder(frozen.manifest, recorded);
  if (frozen.recorded !== input.checkpoint.sequence
    || plan.expectedCells !== 72) {
    throw new Error("Runtime matrix checkpoint count differs from the verified source ledger");
  }
  if (plan.fullOrder.slice(0, recorded.length).some((cell) => !recorded.includes(cell.cellId))) {
    throw new Error("Runtime matrix recorded cells are not a prefix of the frozen pair order");
  }
  const file = path.join(path.resolve(input.directory),
    `checkpoint-${String(input.checkpoint.sequence).padStart(4, "0")}.sqlite`);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Runtime matrix checkpoint head must be an ordinary local file");
  }
  const opened = await openSanitizedRuntimeCorpusCheckpoint(file);
  try {
    const source = await createEvaluationRunRuntime({
      work: async (operation) => operation(opened.db), now: () => 0, createId: () => "",
    }).inspect(input.evaluationRunId);
    if (opened.sha256 !== input.checkpoint.sha256
      || source.manifestHash !== frozen.manifestHash
      || JSON.stringify(source.cases) !== JSON.stringify(frozen.cases)) {
      throw new Error("Runtime matrix checkpoint head differs from the live source ledger");
    }
  } finally { await opened.db.destroy(); }
  let sha256 = input.checkpoint.sha256;
  let sequence = input.checkpoint.sequence;
  let executed = 0;
  for (const cell of plan.remaining) {
    if (executed >= (input.maxNewCells ?? Number.MAX_SAFE_INTEGER)) break;
    const saved = await runRuntimeCorpusCell({ journal: input.journal,
      db: input.db, directory: input.directory, cellId: cell.cellId,
      previousCheckpointSha256: sha256, sequence: sequence + 1,
      secretValues: input.secretValues,
      preflight: () => input.preflight(cell), execute: () => input.execute(cell) });
    sha256 = saved.sha256;
    sequence++;
    executed++;
  }
  const current = await input.evaluation.inspect(input.evaluationRunId);
  if (current.recorded !== sequence) {
    throw new Error("Runtime matrix source ledger differs from the last checkpoint");
  }
  return { expected: plan.expectedCells, alreadyRecorded: frozen.recorded,
    executed, remaining: current.expected - current.recorded,
    checkpoint: { sha256, sequence } };
}
