import express from "express";
import { z } from "zod";
import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    trackId: z.number(),
    videoId: z.number(),
  }),
  async (req, res) => {
    const { trackId, videoId } = req.body;
    await getDatabaseRuntime().work((db) =>
      db.transaction(async (trx) => {
        const video = await trx("o_video").where({ id: videoId, videoTrackId: trackId, state: "生成成功" }).first();
        if (!video?.artifactRevisionId) throw new Error("只能选择当前 Track 已生成成功的 Artifact Revision");
        await trx("o_artifactRevision").where({ videoTrackId: trackId, status: "accepted" }).update({ status: "generated" });
        await trx("o_artifactRevision").where("id", video.artifactRevisionId).update({ status: "accepted" });
        await trx("o_videoTrack").where("id", trackId).update({
          videoId,
        });
      }),
    );
    res.status(200).send(success({ message: "视频选择成功" }));
  },
);
