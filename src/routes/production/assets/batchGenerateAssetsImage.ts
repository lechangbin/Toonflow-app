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
    const promptRecord: Record<string, { prompt: string; label: string; focus: string }> = {
      role: {
        prompt: rolePrompt,
        label: "角色衍生资产",
        focus: "注重人物的姿态、表情、服饰细节、体态特征与情绪表达，保持与原始角色设计的一致性（如发型、瞳色、服装风格），同时体现衍生场景下的变化。",
      },
      tool: {
        prompt: toolPrompt,
        label: "道具衍生资产",
        focus: "注重道具的材质质感、光影效果、结构细节与功能特征，保持与原始道具设计的一致性（如形状、配色、标志性元素），清晰展示道具在不同状态或角度下的视觉表现。",
      },
      scene: {
        prompt: scenePrompt,
        label: "场景衍生资产",
        focus: "注重场景的空间层次、光影氛围、环境细节与情绪渲染，保持与原始场景设计的一致性（如建筑风格、色调、标志性地标），体现不同时间段或天气条件下的视觉变化。",
      },
    };
    const imageData = [];
    for (const item of assetsDataArr) {
      const typeConfig = promptRecord[item.type!] || promptRecord["role"];
      const hasRefImage = !!imageUrlRecord[item.assetsId!];

      const { text } = await u.Ai.Text("universalAi").invoke({
        system: `你是一位专业的 AI 绘画提示词工程师，擅长将资产描述转化为高质量的图片生成提示词。

## 任务
根据用户提供的${typeConfig.label}名称与描述，结合项目美术风格规范，生成一段精准的图片生成提示词（Prompt）。

## 输出要求
- 直接输出最终提示词，不要包含任何解释、标题或标记
- 提示词应为具体的视觉描述，包含主体、构图、光影、色调、氛围等要素
- ${typeConfig.focus}
${hasRefImage ? "- 当前资产有参考图作为风格锚点，提示词应侧重描述衍生变化部分，避免重复参考图已有的基础特征" : "- 当前资产无参考图，提示词需要完整描述视觉特征"}

## 项目美术风格与提示词规范参考
${typeConfig.prompt || "（未指定特定美术风格，请根据资产描述选择合适的画面风格）"}`,
        messages: [
          {
            role: "user",
            content: `资产名称: ${item.name}\n资产描述: ${item.describe || "无详细描述"}`,
          },
        ],
      });

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
      const imageBase64 = imageUrlRecord[item.assetsId!] ? await urlToBase64(imageUrlRecord[item.assetsId!]) : null;
      try {
        const imageCls = await u.Ai.Image(projectSettingData?.imageModel as `${string}:${string}`).run({
          prompt: text,
          imageBase64: imageBase64 ? [imageBase64] : [],
          size: projectSettingData?.imageQuality as "1K" | "2K" | "4K",
          aspectRatio: "16:9",
          taskClass: "生成图片",
          describe: "资产图片生成",
          relatedObjects: JSON.stringify(repeloadObj),
          projectId: projectId,
        });
        const savePath = `/${projectId}/assets/${scriptId}/${u.uuid()}.jpg`;
        await imageCls.save(savePath);
        //   更新对应数据库
        await u.db("o_assets").where("id", item.id).update({ imageId: imageId });
        await u.db("o_image").where({ id: imageId }).update({ state: "已完成", filePath: savePath });
        imageData.push({
          id: item.id,
          state: "已完成",
          src: await u.oss.getFileUrl(savePath),
        });
      } catch (e) {
        console.log("%c Line:95 🥛 e", "background:#fca650", e);
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
