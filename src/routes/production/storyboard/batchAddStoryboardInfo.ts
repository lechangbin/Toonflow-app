import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
interface Storyboard {
  id: number;
  track: string;
  src: string | null;
  associateAssetsIds: number[];
  duration: number;
  state: string;
}
export default router.post(
  "/",
  validateFields({
    data: z.array(
      z.object({
        prompt: z.string(),
        duration: z.number(),
        track: z.string(),
        state: z.string(),
        src: z.string().nullable(),
        associateAssetsIds: z.array(z.number()),
      }),
    ),
    scriptId: z.number(),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { data, scriptId, projectId } = req.body;
    if (!data.length) return res.status(400).send({ success: false, message: "数据不能为空" });
    for (const item of data) {
      const [id] = await u.db("o_storyboard").insert({
        prompt: item.prompt,
        duration: String(item.duration),
        state: item.state,
        scriptId,
        projectId,
        createTime: Date.now(),
      });
      if (item.associateAssetsIds?.length) {
        await u.db("o_assets2Storyboard").insert(
          item.associateAssetsIds.map((assetId: number) => ({
            assetId,
            storyboardId: id,
          })),
        );
      }
      item.id = id;
    }
    //根据track分组
    const storyboardGroupByTrack: Record<string, number[]> = {};
    data.forEach((item: any) => {
      if (!storyboardGroupByTrack[item.track]) {
        storyboardGroupByTrack[item.track] = [];
      }
      storyboardGroupByTrack[item.track].push(item.id);
    });

    //循环
    for (const track in storyboardGroupByTrack) {
      const [trackId] = await u.db("o_videoTrack").insert({
        scriptId,
        projectId,
      });
      const storyboardIds = storyboardGroupByTrack[track] ?? [];
      await u.db("o_storyboard").whereIn("id", storyboardIds).update({ trackId });
    }
    const lastStoryboard = await u
      .db("o_storyboard")
      .where("scriptId", scriptId)
      .select("id", "trackId", "prompt", "duration", "state", "scriptId", "reason", "filePath");
    if (!lastStoryboard || !lastStoryboard.length) return res.status(400).send(error("为查到分镜数据"));
    const storyboardData = await Promise.all(
      lastStoryboard.map(async (i) => {
        return {
          associateAssetsIds: await u.db("o_assets2Storyboard").where("storyboardId", i.id).select("assetId").pluck("assetId"),
          src: i.filePath ? await u.oss.getFileUrl(i.filePath) : "",
          id: i.id,
          trackId: i.trackId,
          prompt: i.prompt,
          duration: Number(i.duration),
          state: i.state,
          scriptId: i.scriptId,
          reason: i.reason,
        };
      }),
    );
    return res.status(200).send(success(storyboardData));
  },
);
