import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { EvaluationAssessment } from "./evaluationAssessment";

const allowedRef = /^(?:docs|data|tests|artifacts)\/[A-Za-z0-9._\/-]+$/u;

/** Verify local file identity and declared artifact digests, not the semantic gate verdict. */
export async function verifyEvaluationAssessmentArtifacts(root: string,
  assessment: EvaluationAssessment): Promise<{
    sourceEvidenceHash: string;
    files: Array<{ ref: string; sha256: string }>;
    artifactHashesVerified: true;
    gateSemanticsVerified: false;
    reviewerIdentityVerified: false;
  }> {
  const rootReal = await fs.realpath(root);
  const refs = new Set<string>(assessment.artifacts.map((artifact) => artifact.ref));
  for (const gate of assessment.hardGates) {
    for (const ref of gate.evidenceRefs) refs.add(ref);
  }
  for (const ref of assessment.quality.evidenceRefs) refs.add(ref);
  const files = [];
  for (const ref of [...refs].sort()) {
    if (!allowedRef.test(ref) || ref.split("/").includes("..")) {
      throw new TypeError("Assessment evidence reference is unsafe");
    }
    const candidate = path.resolve(rootReal, ...ref.split("/"));
    const real = await fs.realpath(candidate);
    const relative = path.relative(rootReal, real);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative)) {
      throw new TypeError("Assessment evidence escapes the verification root");
    }
    if (!(await fs.stat(real)).isFile()) {
      throw new TypeError("Assessment evidence is not a regular file");
    }
    const sha256 = createHash("sha256").update(await fs.readFile(real)).digest("hex");
    for (const artifact of assessment.artifacts.filter((entry) => entry.ref === ref)) {
      if (artifact.sha256 !== sha256) {
        throw new TypeError("Assessment artifact digest differs from file content");
      }
    }
    files.push({ ref, sha256 });
  }
  return { sourceEvidenceHash: assessment.sourceEvidenceHash,
    files, artifactHashesVerified: true,
    gateSemanticsVerified: false, reviewerIdentityVerified: false };
}
