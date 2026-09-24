export const SKILL_PERMISSION_DECISION_SCHEMA_VERSION = "toonflow.skill-permission-decision.v1" as const;

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
