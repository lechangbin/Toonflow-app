import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory from "knex";

import { freezeAgentRuntimeEvaluationRun } from "../src/eval/agentRuntimeEvaluationFreeze";
import { createEvaluationRunRuntime, evaluationCaseRequestId } from "../src/eval/evaluationRun";
import { writeSanitizedRuntimeCorpusCheckpoint } from "../src/eval/runtimeCorpusCheckpoint";
import { openRuntimeCorpusExecutionJournal } from "../src/eval/runtimeCorpusExecutionJournal";
import initDB from "../src/lib/initDB";

test("T11 journal binds completion to a new source-verified v3 cell and predecessor", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "toonflow-runtime-journal-"));
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true,
    pool: { min: 1, max: 1 } });
  const secret = "sk-test-journal-secret";
  let journal: Awaited<ReturnType<typeof openRuntimeCorpusExecutionJournal>> | null = null;
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const oldLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = oldLog; }
    await db("o_vendorConfig").where({ id: "agnes" })
      .update({ inputValues: JSON.stringify({ apiKey: secret }) });
    const source = await fs.readFile(path.resolve(
      "data/eval/agent-runtime-corpus-v1/manifest.json"), "utf8");
    const corpus = JSON.parse(source) as { cases: Array<{ id: string; content: string }> };
    const fixture = await fs.readFile(path.resolve(
      "data/eval/fixtures/agent-runtime-project-v1.json"), "utf8");
    const revisions = { app: "app-1", schema: "schema-1", runtime: "runtime-1",
      tool: "tool-1", context: "context-1", memory: "memory-1",
      skill: "skill-1", model: "model-1", vendor: "vendor-1" };
    let serial = 0;
    const evaluation = createEvaluationRunRuntime({ work: async (operation) => operation(db),
      now: () => 200, createId: () => `journal-${++serial}` });
    const frozen = await freezeAgentRuntimeEvaluationRun(evaluation, {
      manifestSource: source, studyId: "journal-study", seeds: [11, 29],
      baseline: revisions, candidate: { ...revisions, app: "app-2" }, frozenAt: 100,
      projectIds: Object.fromEntries(corpus.cases.map((item) => [item.id, 7])),
      readFixture: async () => fixture,
    });
    const initial = await writeSanitizedRuntimeCorpusCheckpoint({ db, directory,
      sequence: 0, secretValues: [secret] });
    journal = await openRuntimeCorpusExecutionJournal(directory, frozen.id);
    await assert.rejects(openRuntimeCorpusExecutionJournal(directory, frozen.id), /execution actor/u);
    const orphan = path.join(directory, "checkpoint-0001.sqlite");
    await fs.writeFile(orphan, "orphan");
    await assert.rejects(journal.assertResumeSafe(), /orphan or missing checkpoint/u);
    await fs.unlink(orphan);
    const caseName = corpus.cases[0];
    const addCell = async (variant: "baseline" | "candidate", runId: string) => {
      await db("o_agentRun").insert({ id: runId, projectId: 7,
        role: "scriptAgent", scope: "read-only-project-guidance-v1",
        clientRequestId: evaluationCaseRequestId(frozen.id, variant, caseName.id, 11),
        requestFingerprint: "test", input: JSON.stringify({ content: caseName.content, actorUserId: 1 }),
        status: "failed", allowedActions: "[]", version: 2,
        createdAt: 210, updatedAt: 230, completedAt: 230 });
      await db("o_agentTrace").insert({ id: `trace-${runId}`, runId, sequence: 1,
        eventType: "run-failed", createdAt: 230 });
      await evaluation.record({ evaluationRunId: frozen.id, variant,
        caseId: caseName.id, seed: 11, agentRunId: runId });
    };
    const baseline = `baseline:${caseName.id}:11`;
    await journal.begin(baseline, initial.sha256);
    await assert.rejects(journal.assertResumeSafe(), /unresolved in-flight/u);
    await journal.close();
    journal = await openRuntimeCorpusExecutionJournal(directory, frozen.id);
    await assert.rejects(journal.assertResumeSafe(), /unresolved in-flight/u);
    await addCell("baseline", "run-baseline");
    const first = await writeSanitizedRuntimeCorpusCheckpoint({ db, directory,
      sequence: 1, secretValues: [secret] });
    await journal.complete(baseline, first);
    await journal.assertResumeSafe();
    await assert.rejects(journal.begin(baseline, first.sha256), /already completed/u);
    const candidate = `candidate:${caseName.id}:11`;
    await journal.begin(candidate, first.sha256);
    await assert.rejects(journal.complete(candidate, first), /discontinuous|transition/u);
    await assert.rejects(journal.assertResumeSafe(), /unresolved in-flight/u);
    await addCell("candidate", "run-candidate");
    const second = await writeSanitizedRuntimeCorpusCheckpoint({ db, directory,
      sequence: 2, secretValues: [secret] });
    await journal.complete(candidate, second);
    await journal.assertResumeSafe();
    await fs.writeFile(second.path, "tampered");
    await assert.rejects(journal.assertResumeSafe(), /completion or checkpoint is corrupt/u);
  } finally {
    await journal?.close();
    await db.destroy();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
