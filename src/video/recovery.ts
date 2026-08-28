import type { Knex } from "knex";

const interruptionReason = "软件退出导致失败";

export async function failInterruptedVideoProduction(db: Knex, completedAt = Date.now()): Promise<void> {
  await db.transaction(async (trx) => {
    const interruptedActionIds = (await trx("o_productionAction").where("status", "running").select("id")).map(
      (row: { id: number }) => row.id,
    );
    const interruptedTaskIds = (await trx("o_generationTask").where("status", "running").select("id")).map(
      (row: { id: number }) => row.id,
    );

    await trx("o_productionAction").where("status", "running").update({ status: "failed", completedAt });
    await trx("o_generationTask")
      .where("status", "running")
      .update({ status: "failed", completedAt, error: interruptionReason });
    await trx("o_videoTrack").where("state", "生成中").update({ state: "生成失败", reason: interruptionReason });

    if (interruptedActionIds.length || interruptedTaskIds.length) {
      await trx("o_artifactRevision")
        .where("status", "draft")
        .andWhere(function () {
          if (interruptedActionIds.length) this.orWhereIn("actionId", interruptedActionIds);
          if (interruptedTaskIds.length) this.orWhereIn("generationTaskId", interruptedTaskIds);
        })
        .update({ status: "rejected" });
    }

    await trx("o_video").where("state", "生成中").update({ state: "生成失败", errorReason: interruptionReason });
  });
}
