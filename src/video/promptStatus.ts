import type { Knex } from "knex";

export interface VideoPromptStatusRequest {
  projectId: number;
  scriptId: number;
  trackIds: number[];
}

export interface VideoPromptStatus {
  id: number;
  state: "已完成" | "生成失败";
  reason: string | null;
  prompt: string;
}

interface PromptStatusRow {
  id: number;
  state: string;
  reason: string | null;
  promptRevisionId: number | null;
  revisionId: number | null;
  renderedPrompt: string | null;
}

export async function readVideoPromptStatuses(
  db: Knex,
  input: VideoPromptStatusRequest,
): Promise<VideoPromptStatus[]> {
  if (input.trackIds.length === 0) return [];

  const rows = (await db("o_videoTrack as track")
    .leftJoin("o_promptRevision as revision", function joinOwnedPromptRevision() {
      this.on("revision.id", "=", "track.promptRevisionId")
        .andOn("revision.projectId", "=", "track.projectId")
        .andOn("revision.videoTrackId", "=", "track.id");
    })
    .where("track.projectId", input.projectId)
    .where("track.scriptId", input.scriptId)
    .whereIn("track.id", input.trackIds)
    .whereIn("track.state", ["已完成", "生成失败"])
    .select({
      id: "track.id",
      state: "track.state",
      reason: "track.reason",
      promptRevisionId: "track.promptRevisionId",
      revisionId: "revision.id",
      renderedPrompt: "revision.renderedPrompt",
    })) as PromptStatusRow[];

  return rows.map((row) => {
    if (row.state === "生成失败") {
      return { id: row.id, state: row.state, reason: row.reason, prompt: "" };
    }
    if (row.state !== "已完成") throw new Error(`Video Track ${row.id} 不是终态`);
    if (!row.promptRevisionId) throw new Error(`Video Track ${row.id} 已完成但没有 Prompt Revision`);
    if (row.revisionId !== row.promptRevisionId || row.renderedPrompt === null) {
      throw new Error(
        `Prompt Revision ${row.promptRevisionId} 不属于 Project ${input.projectId} / Video Track ${row.id}`,
      );
    }
    return { id: row.id, state: row.state, reason: row.reason, prompt: row.renderedPrompt };
  });
}
