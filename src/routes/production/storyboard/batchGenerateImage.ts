import express from "express";
import u from "@/utils";
import { z } from "zod";
import sharp from "sharp";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { Output } from "ai";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    storyboardIds: z.array(z.number()),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { storyboardIds, projectId } = req.body;

    const projectSettingData = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "artStyle").first();

    const sceneArkPrompt = u.getArtPrompt(projectSettingData?.artStyle || "", "art_storyboard");
    const storyboardData = await u.db("o_storyboard").whereIn("id", storyboardIds).select("id", "description", "title");
    const { text } = await u.Ai.Text("universalAi").invoke({
      system: `
        你需要根据用户提供的分镜的标题与描述，结合当前项目的美术风格，为我优化提示词以便生成更符合项目美术风格的分镜图片。请你只优化提示词，不要添加任何额外的描述性文字，请以JSON格式输出: [{id:"对应分镜ID",prompt:"分镜提示词"}]。
        美术风格：${sceneArkPrompt}`,
      messages: [
        {
          role: "user",
          content: `一下是我的分镜内容\n ${storyboardData.map((s) => `分镜ID:${s.id},分镜描述:${s.description},分镜标题:${s.title}`).join("\n")}`,
        },
      ],
      output: Output.object({
        schema: z.array(
          z.object({
            prompt: z.string().describe("优化后的提示词"),
          }),
        ),
      }),
    });
    for (const item of storyboardData) {
      const repeloadObj = {
        prompt: text,
        size: projectSettingData?.imageQuality as "1K" | "2K" | "4K",
        aspectRatio: "16:9",
      };
      u.Ai.Image(projectSettingData?.imageModel as `${string}:${string}`).run({
        prompt: text,
        imageBase64: [],
        size: projectSettingData?.imageQuality as "1K" | "2K" | "4K",
        aspectRatio: "16:9",
        taskClass: "生成图片",
        describe: "资产图片生成",
        relatedObjects: JSON.stringify(repeloadObj),
        projectId: projectId,
      });
      // .then(async (imageCls) => {
      //   const savePath = `/${resTool.data.projectId}/assets/${resTool.data.scriptId}/${u.uuid()}.jpg`;
      //   await imageCls.save(savePath);
      //   const obj = {
      //     ...item,
      //     id: item.assetId,
      //     src: await u.oss.getFileUrl(savePath),
      //     state: "已完成",
      //   };
      //更新对应数据库
      //   await u.db("o_assets").where("id", item.assetId).update({ imageId: imageId });
      //   await u.db("o_image").where({ id: imageId }).update({ state: "已完成", filePath: savePath });
      // });
    }

    return res.status(200).send(success());
  },
);
