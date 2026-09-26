import type { Knex } from "knex";

import { writeSanitizedRuntimeCorpusCheckpoint } from "./runtimeCorpusCheckpoint";
import { openRuntimeCorpusExecutionJournal } from "./runtimeCorpusExecutionJournal";

type Journal = Awaited<ReturnType<typeof openRuntimeCorpusExecutionJournal>>;

/** One cell, one external-call boundary. Any failure after begin requires reconciliation. */
export async function runRuntimeCorpusCell(input: {
  journal: Journal;
  db: Knex;
  directory: string;
  cellId: string;
  previousCheckpointSha256: string;
  sequence: number;
  secretValues: string[];
  execute(): Promise<unknown>;
}) {
  await input.journal.begin(input.cellId, input.previousCheckpointSha256);
  await input.execute();
  const saved = await writeSanitizedRuntimeCorpusCheckpoint({ db: input.db,
    directory: input.directory, sequence: input.sequence,
    secretValues: input.secretValues });
  await input.journal.complete(input.cellId, saved);
  return saved;
}
