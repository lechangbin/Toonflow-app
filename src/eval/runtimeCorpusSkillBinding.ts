import { createHash } from "node:crypto";

import type { DatabaseWork } from "@/database";
import { validateSkillManifest } from "@/skillRuntime/manifest";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Fingerprint the two live Harness bindings from published, active, intact revisions. */
export async function inspectRuntimeCorpusSkillBinding(input: { work: DatabaseWork;
  scriptSkillId: string; productionSkillId: string }) {
  if (!/^[A-Za-z0-9._:@-]{1,128}$/u.test(input.scriptSkillId)
    || !/^[A-Za-z0-9._:@-]{1,128}$/u.test(input.productionSkillId)
    || input.scriptSkillId === input.productionSkillId) {
    throw new TypeError("T11 Harness Skill identities are invalid");
  }
  return input.work((db) => db.transaction(async (tx) => {
    const roles = [{ role: "scriptAgent", skillId: input.scriptSkillId },
      { role: "productionAgent", skillId: input.productionSkillId }];
    const bound = [];
    for (const expected of roles) {
      const row = await tx("o_agentSkillBinding as binding")
        .join("o_agentSkillRevision as revision", "revision.id", "binding.activeRevisionId")
        .join("o_agentSkillRevisionPolicy as policy", "policy.revisionId", "revision.id")
        .where({ "binding.skillId": expected.skillId })
        .first("revision.id", "revision.skillId", "revision.semanticVersion",
          "revision.status", "revision.content", "revision.contentHash",
          "revision.manifestJson", "revision.manifestHash", "policy.state");
      if (!row || row.skillId !== expected.skillId || row.status !== "published"
        || row.state !== "active" || hash(row.content) !== row.contentHash
        || hash(row.manifestJson) !== row.manifestHash) {
        throw new Error("T11 active Harness Skill binding is missing or corrupt");
      }
      const manifest = validateSkillManifest(JSON.parse(row.manifestJson) as unknown,
        expected.skillId, row.semanticVersion);
      if (!manifest.compatibleRoles.includes(expected.role)
        || !manifest.intents.includes("read-only-guidance")) {
        throw new Error("T11 Harness Skill binding has the wrong role or intent");
      }
      bound.push({ role: expected.role, skillId: expected.skillId,
        revisionId: row.id, contentHash: row.contentHash, manifestHash: row.manifestHash,
        requestedTools: manifest.requestedTools,
        requestedCapabilities: manifest.requestedCapabilities });
    }
    return { revision: hash(JSON.stringify(bound)), bindings: bound };
  }));
}

/** A prompt treatment may change wording, never the available authority. */
export function assertEqualRuntimeCorpusSkillAuthority(
  baseline: Awaited<ReturnType<typeof inspectRuntimeCorpusSkillBinding>>,
  candidate: Awaited<ReturnType<typeof inspectRuntimeCorpusSkillBinding>>,
): void {
  for (let index = 0; index < 2; index++) {
    const left = baseline.bindings[index];
    const right = candidate.bindings[index];
    if (left.role !== right.role || left.skillId !== right.skillId
      || JSON.stringify(left.requestedTools) !== JSON.stringify(right.requestedTools)
      || JSON.stringify(left.requestedCapabilities) !== JSON.stringify(right.requestedCapabilities)) {
      throw new TypeError("T11 Skill treatment changed Harness authority");
    }
  }
}
