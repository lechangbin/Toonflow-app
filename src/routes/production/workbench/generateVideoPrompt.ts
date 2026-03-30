import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { Output } from "ai";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    storyboardId: z.array(z.number()),
  }),
  async (req, res) => {
    const { projectId, storyboardId } = req.body;
    // 查询分镜及其关联的资产提示词
    const data = await u
      .db("o_storyboard")
      .leftJoin("o_assets2Storyboard", "o_storyboard.id", "o_assets2Storyboard.storyboardId")
      .leftJoin("o_assets", "o_assets2Storyboard.assetId", "o_assets.id")
      .leftJoin("o_videoConfig", "o_storyboard.id", "o_videoConfig.storyboardId")
      .whereIn("o_storyboard.id", storyboardId)
      .select("o_storyboard.id", "o_storyboard.prompt", "o_assets.prompt as assetPrompt", "o_videoConfig.model as videoModel");

    // 按分镜id分组，聚合资产提示词
    const storyboardMap = new Map<number, { prompt: string; assetPrompts: string[]; videoModel: string }>();
    for (const row of data) {
      if (!storyboardMap.has(row.id)) {
        storyboardMap.set(row.id, { prompt: row.prompt || "", assetPrompts: [], videoModel: row.videoModel || "" });
      }
      if (row.assetPrompt) {
        storyboardMap.get(row.id)!.assetPrompts.push(row.assetPrompt);
      }
    }

    // 逐个分镜生成视频提示词
    const results: { storyboardId: number; videoPrompt: string }[] = [];
    for (const [id, { prompt, assetPrompts, videoModel }] of storyboardMap) {
      let model = "";
      if (videoModel) {
        model = videoModel;
      } else {
        const videoModel = await u.db("o_project").where("id", projectId).select("videoModel").first();
        model = videoModel?.videoModel || "";
      }
      if (!model) return res.status(400).json({ error: "未找到视频模型，请检查项目配置" });
      const systemPrompt = `你是一个专业的${model}视频生成助手。请根据分镜提示词和关联资产提示词，生成一段完整的、可直接用于视频生成模型的中文提示词。`;
      const userContent = `分镜提示词：${prompt || "无"}\n资产提示词：${assetPrompts.length > 0 ? assetPrompts.join("\n") : "无"}`;

      const { text } = await u.Ai.Text("universalAi").invoke({
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      });

      await u.db("o_storyboard").where("id", id).update({ videoPrompt: text });
      results.push({ storyboardId: id, videoPrompt: text });
    }

    res.status(200).send(success({ data: results }));
  },
);
