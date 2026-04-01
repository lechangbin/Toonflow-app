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
    if (!lastStoryboard || !lastStoryboard.length) return res.status(400).send(error("未查到分镜数据"));
    batchGenerateVideoPrompts(
      data.map((i: any) => i.id),
      projectId,
    );
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

async function batchGenerateVideoPrompts(storyboardIds: number[], projectId: number) {
  const lastStoryboard = await u.db("o_storyboard").whereIn("id", storyboardIds).select("id", "trackId", "prompt");
  const allTrackIds = lastStoryboard.map((i) => i.trackId);
  const storyboardPromptRecord: Record<number, string[]> = {};
  lastStoryboard.forEach((i) => {
    if (i.trackId) {
      if (!storyboardPromptRecord[i.trackId]) {
        storyboardPromptRecord[i.trackId] = [];
      }
      storyboardPromptRecord[i.trackId].push(i.prompt!);
    }
  });
  const projectSetting = await u.db("o_project").where("id", projectId).select("artStyle").first();
  const systemPrompt = u.getArtPrompt(projectSetting?.artStyle!, "art_storyboard_video");
  await u
    .db("o_videoTrack")
    .whereIn("id", allTrackIds as number[])
    .update({
      state: "生成中",
    });
  for (const trackId in storyboardPromptRecord) {
    const storboardPrompts = storyboardPromptRecord[trackId];
    try {
      const { text } = await u.Ai.Text("universalAi").invoke({
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: `请根据我所提供的 ${storboardPrompts.length} 条分镜内容，为我生成一条视频提示词，请直接输出提示词内容，不做任何解释说明。
            分镜内容如下:
            ${storboardPrompts.map((i, index) => `${index + 1}.${i}`).join("\n")}`,
          },
        ],
      });
      await u.db("o_videoTrack").where("id", trackId).update({
        state: "已完成",
        prompt: text,
      });
      console.log("%c Line:116 🍎 text", "background:#42b983", text);
    } catch (e) {
      console.error("生成视频提示词失败", e);
      await u
        .db("o_videoTrack")
        .where("id", trackId)
        .update({
          state: "生成失败",
          reason: u.error(e).message,
        });
    }
  }
}
