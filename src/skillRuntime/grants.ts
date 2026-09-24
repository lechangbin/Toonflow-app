import type { Knex } from "knex";

import type { DatabaseWork } from "@/database";
import type { ControlledToolName } from "@/controlledTools/definitions";

const READ_NOVEL = "read:novel" as const;
const READ_SCRIPT_WORKSPACE = "read:script-workspace" as const;
const READ_SCRIPT = "read:script" as const;
const READ_PRODUCTION_WORKSPACE = "read:production-workspace" as const;
const PROPOSE_BILLABLE_IMAGE = "propose:billable-image" as const;
const PROPOSE_DERIVED_ASSET = "propose:derived-asset" as const;
const PROPOSE_SCRIPT_WORKSPACE = "propose:script-workspace" as const;
const PROPOSE_SCRIPT = "propose:script" as const;

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
  async function setCapability(input: { projectId: number; actorUserId: number;
    expectedVersion: number; active: boolean }, capability: typeof READ_NOVEL | typeof READ_SCRIPT_WORKSPACE
      | typeof READ_SCRIPT | typeof READ_PRODUCTION_WORKSPACE
      | typeof PROPOSE_SCRIPT_WORKSPACE | typeof PROPOSE_SCRIPT
      | typeof PROPOSE_BILLABLE_IMAGE | typeof PROPOSE_DERIVED_ASSET) {
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
        .where({ projectId: input.projectId, capability }).first();
      if (Number(prior?.version ?? 0) !== input.expectedVersion) {
        throw new ProjectSkillGrantVersionConflictError();
      }
      const version = input.expectedVersion + 1;
      const state = input.active ? "active" : "revoked";
      if (prior) {
        const changed = await tx("o_agentProjectCapabilityGrant")
          .where({ projectId: input.projectId, capability,
            version: input.expectedVersion })
          .update({ state, version, changedByUserId: input.actorUserId, updatedAt });
        if (changed !== 1) throw new ProjectSkillGrantVersionConflictError();
      } else {
        await tx("o_agentProjectCapabilityGrant").insert({ projectId: input.projectId,
          capability, state, version,
          changedByUserId: input.actorUserId, updatedAt });
      }
      return { projectId: input.projectId, capability, state, version, updatedAt };
    }));
  }
  return {
    async setReadProductionWorkspace(input: { projectId: number; actorUserId: number;
      expectedVersion: number; active: boolean }) {
      return setCapability(input, READ_PRODUCTION_WORKSPACE);
    },
    async setProposeBillableImage(input: { projectId: number; actorUserId: number;
      expectedVersion: number; active: boolean }) {
      return setCapability(input, PROPOSE_BILLABLE_IMAGE);
    },
    async setProposeDerivedAsset(input: { projectId: number; actorUserId: number;
      expectedVersion: number; active: boolean }) {
      return setCapability(input, PROPOSE_DERIVED_ASSET);
    },
    async inspectScriptProposals(projectId: number, actorUserId: number) {
      if (![projectId, actorUserId].every((value) =>
        Number.isSafeInteger(value) && value > 0)) {
        throw new TypeError("Project Skill grant inspect is invalid");
      }
      return dependencies.work(async (db) => {
        if (!await db("o_project").where({ id: projectId,
          userId: actorUserId }).first("id")) {
          throw new ProjectSkillGrantOwnershipError();
        }
        const rows = await db("o_agentProjectCapabilityGrant")
          .where({ projectId }).whereIn("capability",
            [PROPOSE_SCRIPT_WORKSPACE, PROPOSE_SCRIPT]);
        const snapshot = (capability: string) => {
          const row = rows.find((entry) => entry.capability === capability);
          return { active: row?.state === "active", version: Number(row?.version ?? 0) };
        };
        return { workspace: snapshot(PROPOSE_SCRIPT_WORKSPACE),
          script: snapshot(PROPOSE_SCRIPT) };
      });
    },
    async setReadNovel(input: { projectId: number; actorUserId: number;
      expectedVersion: number; active: boolean }) {
      return setCapability(input, READ_NOVEL);
    },
    async setReadScriptWorkspace(input: { projectId: number; actorUserId: number;
      expectedVersion: number; active: boolean }) {
      return setCapability(input, READ_SCRIPT_WORKSPACE);
    },
    async setReadScript(input: { projectId: number; actorUserId: number;
      expectedVersion: number; active: boolean }) {
      return setCapability(input, READ_SCRIPT);
    },
    async setProposeScriptWorkspace(input: { projectId: number; actorUserId: number;
      expectedVersion: number; active: boolean }) {
      return setCapability(input, PROPOSE_SCRIPT_WORKSPACE);
    },
    async setProposeScript(input: { projectId: number; actorUserId: number;
      expectedVersion: number; active: boolean }) {
      return setCapability(input, PROPOSE_SCRIPT);
    },
  };
}

/** A Script model can propose, never commit, only with a current Project grant. */
export async function resolveScriptProposalGrants(tx: Knex.Transaction, input: {
  runId: string; projectId: number; kind: "workspace" | "script";
}) {
  const capability = input.kind === "workspace"
    ? PROPOSE_SCRIPT_WORKSPACE : PROPOSE_SCRIPT;
  const run = await tx("o_agentRun").where({ id: input.runId,
    projectId: input.projectId }).first("id", "role", "scope");
  if (!run) throw new Error("Script proposal grant is outside Run Project scope");
  const projectGrant = await tx("o_agentProjectCapabilityGrant")
    .where({ projectId: input.projectId, capability, state: "active" }).first("version");
  return { platformGrants: [capability],
    projectGrants: projectGrant ? [capability] : [],
    runGrants: run.scope === "script-harness-guidance-v1" ? [capability] : [],
    roleGrants: run.role === "scriptAgent" ? [capability] : [] };
}

/** Platform/role/Run policy is code-owned; Project authority is an explicit current grant row. */
export async function resolveReadOnlyScriptSkillGrants(tx: Knex.Transaction, input: {
  runId: string; projectId: number; toolName: ControlledToolName;
}) {
  if (input.toolName === "get_production_workspace_text") {
    throw new TypeError("Production Tool cannot use Script Skill grants");
  }
  const run = await tx("o_agentRun").where({ id: input.runId,
    projectId: input.projectId }).first("id", "role", "scope");
  const project = await tx("o_project").where({ id: input.projectId }).first("id");
  if (!run || !project) throw new Error("Skill grant request is outside Run Project scope");
  const capability = input.toolName === "get_novel_text" || input.toolName === "get_novel_events"
    ? READ_NOVEL : input.toolName === "get_script_workspace"
      ? READ_SCRIPT_WORKSPACE : READ_SCRIPT;
  const grant = await tx("o_agentProjectCapabilityGrant")
    .where({ projectId: input.projectId, capability,
      state: "active" }).first("version");
  return {
    platformGrants: [capability],
    projectGrants: grant ? [capability] : [],
    runGrants: run.scope === "read-only-project-guidance-v1"
      || run.scope === "script-harness-guidance-v1" ? [capability] : [],
    roleGrants: run.role === "scriptAgent" ? [capability] : [],
  };
}

/** Production capability is distinct from Script grants and defaults to deny. */
export async function resolveProductionSkillGrants(tx: Knex.Transaction, input: {
  runId: string; projectId: number; toolName: ControlledToolName;
}) {
  if (input.toolName !== "get_production_workspace_text") {
    throw new TypeError("Unsupported Production Tool grant request");
  }
  const run = await tx("o_agentRun").where({ id: input.runId,
    projectId: input.projectId }).first("id", "role", "scope");
  const project = await tx("o_project").where({ id: input.projectId }).first("id");
  if (!run || !project) throw new Error("Production grant is outside Run Project scope");
  const grant = await tx("o_agentProjectCapabilityGrant")
    .where({ projectId: input.projectId, capability: READ_PRODUCTION_WORKSPACE,
      state: "active" }).first("version");
  return { platformGrants: [READ_PRODUCTION_WORKSPACE],
    projectGrants: grant ? [READ_PRODUCTION_WORKSPACE] : [],
    runGrants: run.scope === "production-harness-v1" ? [READ_PRODUCTION_WORKSPACE] : [],
    roleGrants: run.role === "productionAgent" ? [READ_PRODUCTION_WORKSPACE] : [] };
}

/** A model proposal cannot borrow actual generation authority. */
export async function resolveProductionImageProposalGrants(tx: Knex.Transaction, input: {
  runId: string; projectId: number;
}) {
  const run = await tx("o_agentRun").where({ id: input.runId,
    projectId: input.projectId }).first("id", "role", "scope");
  const project = await tx("o_project").where({ id: input.projectId }).first("id");
  if (!run || !project) throw new Error("Production image proposal is outside Run Project scope");
  const grant = await tx("o_agentProjectCapabilityGrant")
    .where({ projectId: input.projectId, capability: PROPOSE_BILLABLE_IMAGE,
      state: "active" }).first("version");
  return { platformGrants: [PROPOSE_BILLABLE_IMAGE],
    projectGrants: grant ? [PROPOSE_BILLABLE_IMAGE] : [],
    runGrants: run.scope === "production-harness-v1" ? [PROPOSE_BILLABLE_IMAGE] : [],
    roleGrants: run.role === "productionAgent" ? [PROPOSE_BILLABLE_IMAGE] : [] };
}

/** Derived Asset proposals require a distinct Owner grant, never write authority. */
export async function resolveProductionDerivedAssetProposalGrants(tx: Knex.Transaction, input: {
  runId: string; projectId: number;
}) {
  const run = await tx("o_agentRun").where({ id: input.runId,
    projectId: input.projectId }).first("id", "role", "scope");
  const project = await tx("o_project").where({ id: input.projectId }).first("id");
  if (!run || !project) throw new Error("Production derived Asset proposal is outside Run Project scope");
  const grant = await tx("o_agentProjectCapabilityGrant")
    .where({ projectId: input.projectId, capability: PROPOSE_DERIVED_ASSET,
      state: "active" }).first("version");
  return { platformGrants: [PROPOSE_DERIVED_ASSET],
    projectGrants: grant ? [PROPOSE_DERIVED_ASSET] : [],
    runGrants: run.scope === "production-harness-v1" ? [PROPOSE_DERIVED_ASSET] : [],
    roleGrants: run.role === "productionAgent" ? [PROPOSE_DERIVED_ASSET] : [] };
}
