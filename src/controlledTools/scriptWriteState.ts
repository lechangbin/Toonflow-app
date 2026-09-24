import { createHash } from "node:crypto";

import type { Knex } from "knex";

import type { ScriptContentWriteInput, ScriptWorkspaceWriteInput } from "./scriptWriteContract";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class ScriptWriteTargetConflictError extends Error {
  constructor(readonly reason: "project" | "ambiguous-workspace" | "missing-script" | "duplicate-name") {
    super(`Script write target is unavailable: ${reason}`);
  }
}

async function assertProject(db: Knex | Knex.Transaction, projectId: number): Promise<void> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0
    || !await db("o_project").where({ id: projectId }).first("id")) {
    throw new ScriptWriteTargetConflictError("project");
  }
}

/** Hash exact legacy row state; no optimistic version column exists yet. */
export async function scriptWorkspaceTargetState(db: Knex | Knex.Transaction,
  projectId: number, payload: ScriptWorkspaceWriteInput) {
  await assertProject(db, projectId);
  const rows = await db("o_agentWorkData")
    .where({ projectId, key: "scriptAgent" }).orderBy("id", "asc")
    .limit(2).select("id", "data", "createTime", "updateTime");
  if (rows.length > 1) throw new ScriptWriteTargetConflictError("ambiguous-workspace");
  const row = rows[0] ?? null;
  return { rowId: row?.id ?? null,
    stateHash: sha256(JSON.stringify({ kind: "script-workspace", projectId,
      key: payload.key, row })) };
}

/** Create fingerprints same-name competitors; update fingerprints its Project-owned row. */
export async function scriptContentTargetState(db: Knex | Knex.Transaction,
  projectId: number, payload: ScriptContentWriteInput) {
  await assertProject(db, projectId);
  if (payload.effect === "create") {
    const competitor = await db("o_script").where({ projectId, name: payload.name }).first("id");
    if (competitor) throw new ScriptWriteTargetConflictError("duplicate-name");
    return { scriptId: null,
      stateHash: sha256(JSON.stringify({ kind: "script-create", projectId, name: payload.name,
        existing: null })) };
  }
  const row = await db("o_script").where({ id: payload.scriptId, projectId })
    .first("id", "projectId", "name", "content", "extractState", "errorReason", "createTime");
  if (!row) throw new ScriptWriteTargetConflictError("missing-script");
  const competitor = await db("o_script").where({ projectId, name: payload.name })
    .whereNot("id", payload.scriptId).first("id");
  if (competitor) throw new ScriptWriteTargetConflictError("duplicate-name");
  return { scriptId: row.id,
    stateHash: sha256(JSON.stringify({ kind: "script-update", projectId,
      target: row, name: payload.name, competitor: null })) };
}
