import { createHash } from "node:crypto";

import type { Knex } from "knex";

import { getControlledToolDefinition, type ControlledToolName } from "@/controlledTools/definitions";

import { validateSkillManifest } from "./manifest";

export const SKILL_PERMISSION_DECISION_SCHEMA_VERSION = "toonflow.skill-permission-decision.v1" as const;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export interface SkillPermissionInput {
  toolName: string;
  toolRequiredCapabilities: readonly string[];
  skillRequestedTools: readonly string[];
  skillRequestedCapabilities: readonly string[];
  platformGrants: readonly string[];
  projectGrants: readonly string[];
  runGrants: readonly string[];
  roleGrants: readonly string[];
}

export type PermissionLayer = "skill-tool-request" | "skill-capability-request"
  | "platform" | "project" | "run" | "role";

/** A Skill request is never a grant. Every Tool-required capability must survive every authority layer. */
export function evaluateSkillToolPermission(input: SkillPermissionInput) {
  const missing: Array<{ layer: PermissionLayer; capability: string }> = [];
  if (!input.skillRequestedTools.includes(input.toolName)) {
    missing.push({ layer: "skill-tool-request", capability: input.toolName });
  }
  const layers = [
    ["skill-capability-request", input.skillRequestedCapabilities],
    ["platform", input.platformGrants], ["project", input.projectGrants],
    ["run", input.runGrants], ["role", input.roleGrants],
  ] as const;
  for (const capability of [...new Set(input.toolRequiredCapabilities)].sort()) {
    for (const [layer, grants] of layers) {
      if (!grants.includes(capability)) missing.push({ layer, capability });
    }
  }
  return { schemaVersion: SKILL_PERMISSION_DECISION_SCHEMA_VERSION,
    allowed: missing.length === 0, missing };
}

/** The effective request comes only from a Run-frozen, hash-verified Skill Revision. */
export async function authorizeBoundSkillTool(tx: Knex.Transaction, input: {
  runId: string; projectId: number; skillId: string; toolName: ControlledToolName;
  toolRevision: string;
  platformGrants: readonly string[]; projectGrants: readonly string[];
  runGrants: readonly string[]; roleGrants: readonly string[];
}) {
  const definition = getControlledToolDefinition(input.toolName, input.toolRevision);
  if (!definition) throw new Error("Skill Tool definition is unavailable");
  const run = await tx("o_agentRun").where({ id: input.runId,
    projectId: input.projectId }).first("id", "role");
  const binding = await tx("o_agentRunSkillBinding").where({ runId: input.runId,
    skillId: input.skillId }).first();
  if (!run || !binding) throw new Error("Skill Tool is outside authorized Run binding");
  const revision = await tx("o_agentSkillRevision").where({ id: binding.revisionId,
    skillId: input.skillId, status: "published" }).first();
  if (!revision || revision.contentHash !== binding.contentHash
    || revision.manifestHash !== binding.manifestHash
    || hash(revision.content) !== binding.contentHash
    || hash(revision.manifestJson) !== binding.manifestHash) {
    throw new Error("Skill Tool binding evidence is corrupt");
  }
  const policy = await tx("o_agentSkillRevisionPolicy")
    .where({ revisionId: revision.id }).first("state");
  if (!policy || policy.state === "revoked") throw new Error("Skill Tool Revision was revoked");
  const manifest = validateSkillManifest(JSON.parse(revision.manifestJson),
    input.skillId, revision.semanticVersion);
  if (!manifest.compatibleRoles.includes(run.role)) {
    throw new Error("Skill Tool Run role is incompatible with frozen Revision");
  }
  return { skillRevisionId: revision.id, decision: evaluateSkillToolPermission({
    toolName: input.toolName, toolRequiredCapabilities: definition.policy.capabilities,
    skillRequestedTools: manifest.requestedTools,
    skillRequestedCapabilities: manifest.requestedCapabilities,
    platformGrants: input.platformGrants, projectGrants: input.projectGrants,
    runGrants: input.runGrants, roleGrants: input.roleGrants,
  }) };
}
