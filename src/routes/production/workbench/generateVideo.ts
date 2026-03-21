import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    scriptId: z.number(),
    projectId: z.number(),
    storyboardId: z.number(),
    prompt: z.string(),
    imageData: z.array(z.string()).optional(),
    model: z.string(),
    duration: z.number(),
    resolution: z.string(),
    audio: z.boolean().optional(),
    modeData: z.string(),
  }),
  async (req, res) => {
    const { scriptId, projectId, storyboardId, prompt, imageData, model, duration, resolution, audio, modeData } = req.body;
    console.log("%c Line:24 🍡 req.body", "background:#b03734", req.body);
    try {
      const relatedObjects = {
        id: storyboardId,
        projectId,
        type: "视频",
      };
      const systemPrompt = `你是一个专业的视频生成引擎，能够根据用户提供的提示词、图片和参数生成高质量的视频内容。请严格按照用户的需求进行视频创作，确保输出的视频符合以下要求：
1. 视频内容必须与用户提供的提示词和图片相关联，准确反映用户的创意意图。
2. 视频质量应达到专业水平，画面清晰、流畅，符合用户指定的分辨率和时长要求。
3. 视频风格应与用户指定的模式数据相匹配，包括色彩、音乐、特效等元素。
4. 视频中应包含用户提供的图片，并在视频中适当展示，以增强视频的视觉效果。
5. 如果用户指定了音频，请确保视频中的音频与视频内容相匹配，符合用户的创意意图。`;
      const videoPath = `/${projectId}/video/${uuidv4()}.mp4`;
      const aiVideo = u.Ai.Video(model);
      await aiVideo.run({
        systemPrompt, // 系统提示词
        projectId: projectId,
        storyboardId: storyboardId,
        prompt: prompt,
        imageData: imageData,
        modeData: modeData,
        duration: duration,
        resolution: resolution,
        audio: audio,
        taskClass: "视频生成",
        describe: "根据提示词生成视频",
        relatedObjects: JSON.stringify(relatedObjects),
      });
      await aiVideo.save(videoPath); // 保存视频
      //保存视频信息到数据库
    //   await u.db("o_video").insert({
    //     resolution,
    //     prompt,
    //     filePath: videoPath,
    //     model,
    //     time: new Date(),
    //     state: "生成成功",
    //     scriptId: scriptId,
    //   });
      res.status(200).send(success("视频生成成功"));
    } catch (error) {
      res.status(500).send({ error: "视频生成失败" });
    }
  },
);
