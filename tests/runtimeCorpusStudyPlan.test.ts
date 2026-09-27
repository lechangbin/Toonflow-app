import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readRuntimeCorpusStudyPlan, writeRuntimeCorpusStudyPlan } from
  "../src/eval/runtimeCorpusStudyPlan";

test("T11 resume plan is exclusive, hash-bound and never stores an API key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "toonflow-study-plan-"));
  const request = { directory, evaluationRunId: "eval-t11", manifestHash: "a".repeat(64),
    modelPolicyRevision: "b".repeat(64), treatment: {
      scriptSkillId: "script-skill", productionSkillId: "production-skill",
      revisions: { baseline: { script: "script-base", production: "production-base",
        fingerprint: "c".repeat(64) },
      candidate: { script: "script-candidate", production: "production-candidate",
        fingerprint: "d".repeat(64) } },
    } };
  try {
    const file = await writeRuntimeCorpusStudyPlan(request);
    const source = await fs.readFile(file, "utf8");
    assert.equal(source.includes("apiKey"), false);
    assert.equal((await readRuntimeCorpusStudyPlan(request)).treatment.scriptSkillId,
      "script-skill");
    await assert.rejects(writeRuntimeCorpusStudyPlan(request), /EEXIST/u);
    await assert.rejects(readRuntimeCorpusStudyPlan({ ...request,
      modelPolicyRevision: "e".repeat(64) }), /differs from the frozen run/u);
    await fs.writeFile(file, source.replace("script-base", "script-fake"));
    await assert.rejects(readRuntimeCorpusStudyPlan(request), /corrupt/u);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
