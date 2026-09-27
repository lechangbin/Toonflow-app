import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { createEvaluationRunRuntime, RUNTIME_CORPUS_EVALUATION_RUN_VERSION } from "./evaluationRun";
import { openSanitizedRuntimeCorpusCheckpoint } from "./runtimeCorpusCheckpoint";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const cellPattern = /^(?:baseline|candidate):(DEV|HOLD|INC)-[A-Z]+-\d{3}:\d+$/u;
const hashPattern = /^[a-f0-9]{64}$/u;
const checkpointPattern = /^checkpoint-(\d{4,})\.sqlite$/u;
const markerPattern = /^(inflight|completed)-[a-f0-9]{64}\.json$/u;
const exists = async (file: string) => fs.lstat(file).then(() => true,
  (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
const json = async (file: string) => JSON.parse(await fs.readFile(file, "utf8")) as
  Record<string, unknown>;
const writeNew = async (file: string, value: object) => {
  const handle = await fs.open(file, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); }
  finally { await handle.close(); }
};

/** Fail-closed process-crash journal, not a power-loss durability guarantee. */
export async function openRuntimeCorpusExecutionJournal(directoryInput: string,
  evaluationRunId: string) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(evaluationRunId)) {
    throw new TypeError("Runtime journal Evaluation Run identity is invalid");
  }
  const directory = path.resolve(directoryInput);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, ".runner.lock");
  try { await fs.mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Runtime corpus already has an execution actor or an uncleared crash lock");
    }
    throw error;
  }
  let closed = false;
  const paths = (id: string) => {
    if (!cellPattern.test(id)) throw new TypeError("Runtime journal cell identity is invalid");
    const suffix = hash(Buffer.from(id));
    return { started: path.join(directory, `inflight-${suffix}.json`),
      completed: path.join(directory, `completed-${suffix}.json`) };
  };
  const checkpoint = async (file: string) => {
    if (!checkpointPattern.test(file)) throw new Error("Runtime checkpoint name is invalid");
    const full = path.join(directory, file);
    const stat = await fs.lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Runtime checkpoint must be an ordinary local file");
    }
    return hash(await fs.readFile(full));
  };
  const find = async (sha256: string) => {
    const matches: string[] = [];
    for (const entry of await fs.readdir(directory)) {
      if (checkpointPattern.test(entry) && await checkpoint(entry) === sha256) matches.push(entry);
    }
    if (matches.length !== 1) throw new Error("Runtime previous checkpoint is missing or ambiguous");
    return matches[0];
  };
  const inspect = async (file: string) => {
    const opened = await openSanitizedRuntimeCorpusCheckpoint(path.join(directory, file));
    try {
      const state = await createEvaluationRunRuntime({ work: async (operation) => operation(opened.db),
        now: () => 0, createId: () => "" }).inspect(evaluationRunId);
      if (state.manifest.schemaVersion !== RUNTIME_CORPUS_EVALUATION_RUN_VERSION) {
        throw new Error("Runtime journal requires a v3 AgentRuntime corpus");
      }
      return state;
    } finally { await opened.db.destroy(); }
  };
  const transition = async (id: string, previous: string, next: string) => {
    const before = await inspect(previous);
    const after = await inspect(next);
    const key = (item: { variant: string; caseId: string; seed: number }) =>
      `${item.variant}:${item.caseId}:${item.seed}`;
    const oldCases = new Map(before.cases.map((item) => [key(item), JSON.stringify(item)]));
    const newCases = new Map(after.cases.map((item) => [key(item), JSON.stringify(item)]));
    if (before.manifestHash !== after.manifestHash || before.cases.length + 1 !== after.cases.length
      || oldCases.has(id) || !newCases.has(id)
      || [...oldCases].some(([cell, evidence]) => newCases.get(cell) !== evidence)) {
      throw new Error("Runtime checkpoint does not contain exactly the completed cell transition");
    }
  };
  const verifyCompletion = async (id: string) => {
    const files = paths(id);
    const start = await json(files.started);
    const end = await json(files.completed);
    if (end.schemaVersion !== "toonflow.runtime-corpus-completed.v1"
      || end.evaluationRunId !== evaluationRunId || end.cellId !== id
      || end.previousCheckpointSha256 !== start.previousCheckpointSha256
      || typeof end.previousCheckpointSha256 !== "string"
      || !hashPattern.test(end.previousCheckpointSha256)
      || typeof end.checkpoint !== "string" || !checkpointPattern.test(end.checkpoint)
      || typeof end.checkpointSha256 !== "string" || !hashPattern.test(end.checkpointSha256)
      || await checkpoint(end.checkpoint) !== end.checkpointSha256) {
      throw new Error("Runtime journal completion or checkpoint is corrupt");
    }
    const prior = await find(end.previousCheckpointSha256);
    if (Number(checkpointPattern.exec(end.checkpoint)![1])
      !== Number(checkpointPattern.exec(prior)![1]) + 1) {
      throw new Error("Runtime journal checkpoint sequence is discontinuous");
    }
    await transition(id, prior, end.checkpoint);
  };
  return {
    async assertResumeSafe(): Promise<void> {
      if (closed) throw new Error("Runtime journal is closed");
      const entries = await fs.readdir(directory);
      if (entries.some((entry) => entry.endsWith(".pending"))) {
        throw new Error("Runtime corpus has an orphan checkpoint write; manual reconciliation required");
      }
      const starts = entries.filter((entry) => entry.startsWith("inflight-"));
      const ends = entries.filter((entry) => entry.startsWith("completed-"));
      const checkpoints = entries.filter((entry) => checkpointPattern.test(entry));
      if (checkpoints.length !== ends.length + 1
        || checkpoints.some((entry, index) => !entries.includes(
          `checkpoint-${String(index).padStart(4, "0")}.sqlite`))) {
        throw new Error("Runtime journal has an orphan or missing checkpoint");
      }
      if ([...starts, ...ends].some((entry) => !markerPattern.test(entry))) {
        throw new Error("Runtime journal has a malformed marker");
      }
      for (const end of ends) {
        if (!starts.includes(`inflight-${end.slice("completed-".length)}`)) {
          throw new Error("Runtime journal has an orphan completion");
        }
      }
      for (const entry of starts) {
        const start = await json(path.join(directory, entry));
        if (start.schemaVersion !== "toonflow.runtime-corpus-inflight.v1"
          || start.evaluationRunId !== evaluationRunId
          || typeof start.cellId !== "string" || !cellPattern.test(start.cellId)
          || path.basename(paths(start.cellId).started) !== entry
          || typeof start.previousCheckpointSha256 !== "string"
          || !hashPattern.test(start.previousCheckpointSha256)) {
          throw new Error("Runtime journal in-flight marker is corrupt");
        }
        if (!await exists(paths(start.cellId).completed)) {
          throw new Error("Runtime corpus has an unresolved in-flight external call; manual reconciliation required");
        }
        await verifyCompletion(start.cellId);
      }
    },
    async begin(id: string, previousCheckpointSha256: string): Promise<void> {
      if (closed) throw new Error("Runtime journal is closed");
      if (!hashPattern.test(previousCheckpointSha256)) {
        throw new TypeError("Previous Runtime checkpoint hash is invalid");
      }
      await this.assertResumeSafe();
      const files = paths(id);
      if (await exists(files.completed)) throw new Error("Runtime corpus cell is already completed");
      const prior = await find(previousCheckpointSha256);
      if (!(await inspect(prior)).missing.includes(id)) {
        throw new Error("Runtime corpus cell is not missing from the checkpoint");
      }
      const numbers = (await fs.readdir(directory)).filter((entry) => checkpointPattern.test(entry))
        .map((entry) => Number(checkpointPattern.exec(entry)![1]));
      if (Number(checkpointPattern.exec(prior)![1]) !== Math.max(...numbers)) {
        throw new Error("Runtime checkpoint is not the latest sequence");
      }
      await writeNew(files.started, { schemaVersion: "toonflow.runtime-corpus-inflight.v1",
        evaluationRunId, cellId: id, previousCheckpointSha256 });
    },
    async complete(id: string, saved: { path: string; sha256: string }): Promise<void> {
      if (closed) throw new Error("Runtime journal is closed");
      const files = paths(id);
      if (!await exists(files.started) || await exists(files.completed)
        || path.dirname(path.resolve(saved.path)) !== directory
        || !checkpointPattern.test(path.basename(saved.path))
        || !hashPattern.test(saved.sha256)
        || await checkpoint(path.basename(saved.path)) !== saved.sha256) {
        throw new Error("Runtime journal cannot complete without a verified local checkpoint");
      }
      const start = await json(files.started);
      if (start.cellId !== id || start.evaluationRunId !== evaluationRunId
        || typeof start.previousCheckpointSha256 !== "string"
        || !hashPattern.test(start.previousCheckpointSha256)) {
        throw new Error("Runtime journal in-flight marker is corrupt");
      }
      const prior = await find(start.previousCheckpointSha256);
      if (Number(checkpointPattern.exec(path.basename(saved.path))![1])
        !== Number(checkpointPattern.exec(prior)![1]) + 1) {
        throw new Error("Runtime journal checkpoint sequence is discontinuous");
      }
      await transition(id, prior, path.basename(saved.path));
      await writeNew(files.completed, { schemaVersion: "toonflow.runtime-corpus-completed.v1",
        evaluationRunId, cellId: id, previousCheckpointSha256: start.previousCheckpointSha256,
        checkpoint: path.basename(saved.path), checkpointSha256: saved.sha256 });
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await fs.rmdir(lock);
    },
  };
}
