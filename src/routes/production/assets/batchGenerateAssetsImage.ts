import express from "express";
import u from "@/utils";
import { z } from "zod";
import sharp from "sharp";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { Output } from "ai";
import { urlToBase64 } from "@/utils/vm";
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

    const assetsDataArr = await u.db("o_assets").whereIn("id", assetIds).select("id", "describe", "name", "type", "assetsId");
    const parentIds = assetsDataArr.map((item) => item.assetsId).filter((id) => id !== null);
    const parentAssetsData = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .whereIn("o_assets.id", parentIds as number[])
      .select("o_assets.id", "o_image.filePath");
    const assetsSrcArr = await Promise.all(
      parentAssetsData.map(async (item) => {
        return {
          src: await u.oss.getFileUrl(item.filePath),
          id: item.id,
        };
      }),
    );
    const imageUrlRecord: Record<number, string> = {};
    assetsSrcArr.forEach((item) => {
      imageUrlRecord[item.id] = item.src;
    });
    const rolePrompt = u.getArtPrompt(projectSettingData!.artStyle!, "art_character_derivative");
    const toolPrompt = u.getArtPrompt(projectSettingData!.artStyle!, "art_prop_derivative");
    const scenePrompt = u.getArtPrompt(projectSettingData!.artStyle!, "art_scene_derivative");
    const promptRecord: Record<string, { prompt: string }> = {
      role: {
        prompt: rolePrompt,
      },
      tool: {
        prompt: toolPrompt,
      },
      scene: {
        prompt: scenePrompt,
      },
    };
    const imageData = [];
    for (const item of assetsDataArr) {
      const typeConfig = promptRecord[item.type!] || promptRecord["role"];

      const { text } = await u.Ai.Text("universalAi").invoke({
        system: `${typeConfig.prompt}`,
        messages: [
          {
            role: "user",
            content: `资产描述: ${item.describe || "无详细描述"}`,
          },
        ],
      });

      const [imageId] = await u.db("o_image").insert({
        assetsId: item.id,
        type: item.type,
        state: "生成中",
        resolution: projectSettingData?.imageQuality,
        model: projectSettingData?.imageModel,
      });
      const imageBase64 = imageUrlRecord[item.assetsId!] ? await urlToBase64(imageUrlRecord[item.assetsId!]) : null;
      try {
        const repeloadObj = {
          prompt: text,
          size: projectSettingData?.imageQuality as "1K" | "2K" | "4K",
          aspectRatio: "16:9" as `${number}:${number}`,
        };
        const imageCls = await u.Ai.Image(projectSettingData?.imageModel as `${string}:${string}`).run(
          {
            imageBase64: imageBase64 ? [imageBase64] : [],
            ...repeloadObj,
          },
          {
            taskClass: "生成图片",
            describe: "资产图片生成",
            relatedObjects: JSON.stringify(repeloadObj),
            projectId: projectId,
          },
        );
        const savePath = `/${projectId}/assets/${scriptId}/${u.uuid()}.jpg`;
        await imageCls.save(savePath);
        //   更新对应数据库
        await u.db("o_assets").where("id", item.id).update({ imageId: imageId, prompt: text });
        await u.db("o_image").where({ id: imageId }).update({ state: "已完成", filePath: savePath });
        imageData.push({
          id: item.id,
          state: "已完成",
          src: await u.oss.getFileUrl(savePath),
        });
      } catch (e) {
        await u
          .db("o_image")
          .where({ id: imageId })
          .update({ state: "生成失败", reason: u.error(e).message });
        imageData.push({
          id: item.id,
          state: "生成失败",
          src: "",
        });
      }
    }

    return res.status(200).send(success(imageData));
  },
);
