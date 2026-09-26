import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { T11TreatmentSkillPlan } from "./runtimeCorpusTreatmentSkills";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const identity = z.string().regex(/^[A-Za-z0-9._:@-]{1,128}$/u);
const variant = z.strictObject({ script: identity, production: identity,
  fingerprint: digest });
const bodySchema = z.strictObject({ schemaVersion: z.literal("toonflow.runtime-corpus-study-plan.v1"),
  evaluationRunId: identity, manifestHash: digest, modelPolicyRevision: digest,
  treatment: z.strictObject({ scriptSkillId: identity, productionSkillId: identity,
    revisions: z.strictObject({ baseline: variant, candidate: variant }) }) });
const storedSchema = z.strictObject({ body: bodySchema, sha256: digest });
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const fileName = "study-plan.json";

/** Save only reproducible identities, never credentials, fixture contents or Run Output. */
export async function writeRuntimeCorpusStudyPlan(input: { directory: string;
  evaluationRunId: string; manifestHash: string; modelPolicyRevision: string;
  treatment: T11TreatmentSkillPlan }) {
  const body = bodySchema.parse({ schemaVersion: "toonflow.runtime-corpus-study-plan.v1",
    evaluationRunId: input.evaluationRunId, manifestHash: input.manifestHash,
    modelPolicyRevision: input.modelPolicyRevision, treatment: input.treatment });
  if (body.treatment.revisions.baseline.fingerprint
    === body.treatment.revisions.candidate.fingerprint) {
    throw new TypeError("T11 treatment fingerprints must differ");
  }
  const directory = path.resolve(input.directory);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, fileName);
  const handle = await fs.open(file, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify({ body,
      sha256: sha256(JSON.stringify(body)) })}\n`);
    await handle.sync();
  } finally { await handle.close(); }
  return file;
}

/** A resume must rebind this file to the frozen Evaluation Run and Model policy. */
export async function readRuntimeCorpusStudyPlan(input: { directory: string;
  evaluationRunId: string; manifestHash: string; modelPolicyRevision: string }) {
  const file = path.join(path.resolve(input.directory), fileName);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("T11 study plan must be an ordinary local file");
  }
  const stored = storedSchema.parse(JSON.parse(await fs.readFile(file, "utf8")) as unknown);
  if (stored.sha256 !== sha256(JSON.stringify(stored.body))
    || stored.body.evaluationRunId !== input.evaluationRunId
    || stored.body.manifestHash !== input.manifestHash
    || stored.body.modelPolicyRevision !== input.modelPolicyRevision
    || stored.body.treatment.revisions.baseline.fingerprint
      === stored.body.treatment.revisions.candidate.fingerprint) {
    throw new Error("T11 study plan is corrupt or differs from the frozen run");
  }
  return stored.body;
}
