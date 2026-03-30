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
    assetIds: z.array(z.number()),
    projectId: z.number(),
    scriptId: z.number(),
  }),
  async (req, res) => {
    const { assetIds, projectId, scriptId } = req.body;

    const projectSettingData = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "artStyle").first();

    const assetsDataArr = await u.db("o_assets").whereIn("id", assetIds).select("id", "describe", "name", "type");
    const rolePrompt = u.getArtPrompt(projectSettingData!.artStyle!, "art_character_derivative");
    const toolPrompt = u.getArtPrompt(projectSettingData!.artStyle!, "art_prop_derivative");
    const scenePrompt = u.getArtPrompt(projectSettingData!.artStyle!, "art_scene_derivative");
    const promptRecord = {
      role: rolePrompt,
      tool: toolPrompt,
      scene: scenePrompt,
    };

    for (const item of assetsDataArr) {
      const { text } = await u.Ai.Text("universalAi").invoke({
        system: `
        你需要根据用户提供的资产的标题与描述，结合当前项目的美术风格，为我优化提示词以便生成更符合项目美术风格的图片。直接输出提示词，不需要做任何解释说明。
        美术风格：${promptRecord[item.type! as keyof typeof promptRecord]}`,
        messages: [
          {
            role: "user",
            content: `资产名称:${item.name},资产描述:${item.describe}`,
          },
        ],
      });
      console.log("%c Line:35 🎂 text", "background:#3f7cff", text);

      const repeloadObj = {
        prompt: text,
        size: projectSettingData?.imageQuality as "1K" | "2K" | "4K",
        aspectRatio: "16:9",
      };
      const [imageId] = await u.db("o_image").insert({
        assetsId: item.id,
        type: item.type,
        state: "生成中",
        resolution: projectSettingData?.imageQuality,
        model: projectSettingData?.imageModel,
      });
      u.Ai.Image(projectSettingData?.imageModel as `${string}:${string}`)
        .run({
          prompt: text,
          imageBase64: [],
          size: projectSettingData?.imageQuality as "1K" | "2K" | "4K",
          aspectRatio: "16:9",
          taskClass: "生成图片",
          describe: "资产图片生成",
          relatedObjects: JSON.stringify(repeloadObj),
          projectId: projectId,
        })
        .then(async (imageCls) => {
          const savePath = `/${projectId}/assets/${scriptId}/${u.uuid()}.jpg`;
          await imageCls.save(savePath);
          //   更新对应数据库
          await u.db("o_assets").where("id", item.id).update({ imageId: imageId });
          await u.db("o_image").where({ id: imageId }).update({ state: "已完成", filePath: savePath });
        });
    }

    return res.status(200).send(success());
  },
);
