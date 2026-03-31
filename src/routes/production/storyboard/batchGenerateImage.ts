import express from "express";
import u from "@/utils";
import { z } from "zod";
import sharp from "sharp";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { Output, tool } from "ai";
import { urlToBase64 } from "@/utils/vm";
import { assetItemSchema } from "@/agents/productionAgent/tools";
const router = express.Router();
export type AssetData = z.infer<typeof assetItemSchema>;

export default router.post(
  "/",
  validateFields({
    storyboardIds: z.array(z.number()),
    projectId: z.number(),
    scriptId: z.number(),
  }),
  async (req, res) => {
    const {
      storyboardIds,
      projectId,
      scriptId,
    }: {
      storyboardIds: number[];
      projectId: number;
      scriptId: number;
    } = req.body;
    if (!storyboardIds || storyboardIds.length === 0) return res.status(400).send(error("storyboardIds不能为空"));
    // 当没有 storyboardIds 时，通过 AI 生成新的分镜面板数据
    let finalStoryboardIds: number[] = storyboardIds || [];
    await u.db("o_storyboard").whereIn("id", finalStoryboardIds).where("scriptId", scriptId).update({ state: "生成中" });

    const projectSettingData = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "artStyle").first();

    const storyboardData = await u.db("o_storyboard").where("scriptId", scriptId).whereIn("id", finalStoryboardIds);
    const assetData = await u
      .db("o_assets")
      .leftJoin("o_assets2Storyboard", "o_assets.id", "o_assets2Storyboard.assetId")
      .whereIn("o_assets2Storyboard.storyboardId", finalStoryboardIds)
      .select("o_assets2Storyboard.storyboardId", "o_assets.imageId");
    const assetRecord: Record<number, number[]> = {};
    assetData.forEach((item: any) => {
      if (!assetRecord[item.storyboardId]) {
        assetRecord[item.storyboardId] = [];
      }
      assetRecord[item.storyboardId].push(item.imageId);
    });
    res.status(200).send(
      success(
        storyboardData.map((i) => ({
          id: i.id,
          prompt: i.prompt,
          associateAssetsIds: assetRecord[i.id!],
          src: null,
          state: i.state,
        })),
      ),
    );
    for (const item of storyboardData) {
      const repeloadObj = {
        prompt: item.prompt!,
        size: projectSettingData?.imageQuality as "1K" | "2K" | "4K",
        aspectRatio: "16:9" as `${number}:${number}`,
      };
      await u.db("o_storyboard").where("id", item.id).update({
        state: "生成中",
      });
      u.Ai.Image(projectSettingData?.imageModel as `${string}:${string}`)
        .run(
          {
            imageBase64: await getAssetsImageBase64(assetRecord[item.id!] || []),
            ...repeloadObj,
          },
          {
            taskClass: "生成分镜图片",
            describe: "分镜图片生成",
            relatedObjects: JSON.stringify(repeloadObj),
            projectId: projectId,
          },
        )
        .then(async (imageCls) => {
          const savePath = `/${projectId}/assets/${scriptId}/${u.uuid()}.jpg`;
          await imageCls.save(savePath);
          await u.db("o_storyboard").where("id", item.id).update({
            filePath: savePath,
            state: "已完成",
          });
        })
        .catch(async (e) => {
          await u
            .db("o_storyboard")
            .where("id", item.id)
            .update({
              reason: u.error(e).message,
              state: "生成失败",
            });
        });
    }
  },
);
async function getAssetsImageBase64(imageIds: number[]) {
  if (imageIds.length === 0) return [];
  const imagePaths = await u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .whereIn("o_assets.id", imageIds)
    .select("o_assets.id", "o_image.filePath");
  if (!imagePaths.length) return [];
  const imageUrls = await Promise.all(
    imagePaths.map(async (i) => {
      if (i.filePath) {
        try {
          return await urlToBase64(await u.oss.getFileUrl(i.filePath));
        } catch {
          return null;
        }
      } else {
        return null;
      }
    }),
  );
  return imageUrls.filter(Boolean) as string[];
}
