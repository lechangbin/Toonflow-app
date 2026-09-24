import type { Knex } from "knex";

import { HARNESS_TOOL_DEFINITIONS } from "@/controlledTools/definitions";
import { inspectPersistableText } from "@/diagnostics/traceSafeDiagnostics";

/** Bounded, Project-scoped read seam for the future production Harness. */
export async function readProductionWorkspaceText(db: Knex, input: {
  projectId: number; scriptId: number; key: "scriptPlan" | "storyboardTable";
}) {
  const parsed = HARNESS_TOOL_DEFINITIONS.get_production_workspace_text.inputSchema.parse({
    scriptId: input.scriptId, key: input.key });
  if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0) {
    throw new TypeError("Production Project is invalid");
  }
  const script = await db("o_script")
    .where({ id: parsed.scriptId, projectId: input.projectId }).first("id");
  if (!script) throw new Error("Production script is outside Run Project");
  const rows = await db("o_agentWorkData")
    .where({ projectId: input.projectId, episodesId: parsed.scriptId,
      key: "productionAgent" }).limit(2).select("data");
  if (rows.length > 1) throw new Error("Production workspace has duplicate rows");
  const raw = rows[0]?.data;
  if (raw != null && (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 128_000)) {
    throw new Error("Production workspace exceeds read boundary");
  }
  let data: unknown = {};
  if (raw) {
    try { data = JSON.parse(raw); } catch { throw new Error("Production workspace is invalid JSON"); }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Production workspace is invalid");
  }
  const content = (data as Record<string, unknown>)[parsed.key] ?? "";
  if (typeof content !== "string" || !inspectPersistableText(content).ok) {
    throw new Error("Production workspace text is invalid");
  }
  return HARNESS_TOOL_DEFINITIONS.get_production_workspace_text.outputSchema.parse({
    scriptId: parsed.scriptId, key: parsed.key, content,
  });
}
