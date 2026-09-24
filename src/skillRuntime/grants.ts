import type { Knex } from "knex";

import type { DatabaseWork } from "@/database";
import type { ControlledToolName } from "@/controlledTools/definitions";

const READ_NOVEL = "read:novel" as const;

export class ProjectSkillGrantOwnershipError extends Error {
  constructor() { super("Project Skill grant requires the Project owner"); }
}

export class ProjectSkillGrantVersionConflictError extends Error {
  constructor() { super("Project Skill grant version conflict"); }
}

/** Owner-only, version-checked Project grant command. No row means no capability. */
export function createProjectSkillGrantRuntime(dependencies: {
  work: DatabaseWork; now(): number;
}) {
  return {
    async setReadNovel(input: { projectId: number; actorUserId: number;
      expectedVersion: number; active: boolean }) {
      if (![input.projectId, input.actorUserId].every((value) =>
        Number.isSafeInteger(value) && value > 0)
        || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0
        || typeof input.active !== "boolean") {
        throw new TypeError("Project Skill grant command is invalid");
      }
      const updatedAt = dependencies.now();
      if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
        throw new TypeError("Project Skill grant time is invalid");
      }
      return dependencies.work((db) => db.transaction(async (tx) => {
        const project = await tx("o_project").where({ id: input.projectId,
          userId: input.actorUserId }).first("id");
        if (!project) throw new ProjectSkillGrantOwnershipError();
        const prior = await tx("o_agentProjectCapabilityGrant")
          .where({ projectId: input.projectId, capability: READ_NOVEL }).first();
        if (Number(prior?.version ?? 0) !== input.expectedVersion) {
          throw new ProjectSkillGrantVersionConflictError();
        }
        const version = input.expectedVersion + 1;
        const state = input.active ? "active" : "revoked";
        if (prior) {
          const changed = await tx("o_agentProjectCapabilityGrant")
            .where({ projectId: input.projectId, capability: READ_NOVEL,
              version: input.expectedVersion })
            .update({ state, version, changedByUserId: input.actorUserId, updatedAt });
          if (changed !== 1) throw new ProjectSkillGrantVersionConflictError();
        } else {
          await tx("o_agentProjectCapabilityGrant").insert({ projectId: input.projectId,
            capability: READ_NOVEL, state, version,
            changedByUserId: input.actorUserId, updatedAt });
        }
        return { projectId: input.projectId, capability: READ_NOVEL, state, version, updatedAt };
      }));
    },
  };
}

/** Platform/role/Run policy is code-owned; Project authority is an explicit current grant row. */
export async function resolveReadOnlyScriptSkillGrants(tx: Knex.Transaction, input: {
  runId: string; projectId: number; toolName: ControlledToolName;
}) {
  const run = await tx("o_agentRun").where({ id: input.runId,
    projectId: input.projectId }).first("id", "role", "scope");
  const project = await tx("o_project").where({ id: input.projectId }).first("id");
  if (!run || !project) throw new Error("Skill grant request is outside Run Project scope");
  const grant = await tx("o_agentProjectCapabilityGrant")
    .where({ projectId: input.projectId, capability: READ_NOVEL,
      state: "active" }).first("version");
  const readTool = input.toolName === "get_novel_text" || input.toolName === "get_novel_events";
  return {
    platformGrants: readTool ? [READ_NOVEL] : [],
    projectGrants: grant ? [READ_NOVEL] : [],
    runGrants: run.scope === "read-only-project-guidance-v1"
      || run.scope === "script-harness-guidance-v1" ? [READ_NOVEL] : [],
    roleGrants: run.role === "scriptAgent" ? [READ_NOVEL] : [],
  };
}
