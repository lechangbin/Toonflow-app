import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import knexFactory from "knex";

import { inspectRuntimeCorpusSkillBinding } from "../src/eval/runtimeCorpusSkillBinding";
import { activateT11TreatmentSkillVariant, publishT11TreatmentSkills } from
  "../src/eval/runtimeCorpusTreatmentSkills";
import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";

test("T11 publishes equal-authority A/B Skills and switches actual bindings", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const oldLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = oldLog; }
    const work = async <T>(operation: (database: typeof db) => Promise<T> | T) => operation(db);
    let serial = 0;
    const skills = createSkillRuntime({ work, now: () => 200,
      createId: () => `t11-paired-${++serial}` });
    const corpusSource = readFileSync(path.resolve(
      "data/eval/agent-runtime-corpus-v1/manifest.json"), "utf8");
    const plan = await publishT11TreatmentSkills({ skills, work, corpusSource });
    assert.notEqual(plan.revisions.baseline.fingerprint,
      plan.revisions.candidate.fingerprint);
    assert.equal((await inspectRuntimeCorpusSkillBinding({ work,
      scriptSkillId: plan.scriptSkillId,
      productionSkillId: plan.productionSkillId })).revision,
    plan.revisions.baseline.fingerprint);
    const candidate = await activateT11TreatmentSkillVariant({ skills, work,
      corpusSource, plan, variant: "candidate" });
    assert.equal(candidate.revision, plan.revisions.candidate.fingerprint);
    assert.equal(candidate.bindings[0].requestedTools.length, 4);
    assert.equal(candidate.bindings[1].requestedTools.length, 1);
    const idempotent = await activateT11TreatmentSkillVariant({ skills, work,
      corpusSource, plan, variant: "candidate" });
    assert.equal(idempotent.revision, candidate.revision);
    const baseline = await activateT11TreatmentSkillVariant({ skills, work,
      corpusSource, plan, variant: "baseline" });
    assert.equal(baseline.revision, plan.revisions.baseline.fingerprint);
    await assert.rejects(activateT11TreatmentSkillVariant({ skills, work,
      corpusSource, plan: { ...plan,
        revisions: { ...plan.revisions, baseline: { ...plan.revisions.baseline,
          fingerprint: "0".repeat(64) } } }, variant: "baseline" }), /fingerprint differs/u);
  } finally { await db.destroy(); }
});
