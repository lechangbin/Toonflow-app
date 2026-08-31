import express from "express";
import u from "@/utils";
import { z } from "zod";
import { getDatabaseRuntime } from "@/database";
import { createDefaultConfiguredVendor } from "@/vendor";
import sharp from "sharp";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { Output } from "ai";
import { createDefaultConfiguredVendor } from "@/vendor";
import { parseVendorModelName } from "@/vendor/loader";
import { applyLegacyImageReferenceConversion, normalizeHttpResult } from "@/utils/imageGeneration";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    assetIds: z.array(z.number()),
    projectId: z.number(),
    scriptId: z.number(),
    concurrentCount: z.number().min(1).optional(),
  }),
  async (req, res) => {
    const { assetIds, projectId, scriptId, concurrentCount = 5 } = req.body;

    const projectSettingData = await getDatabaseRuntime().work((db) =>
      db("o_project").where("id", projectId).select("imageModel", "imageQuality", "artStyle").first(),
    );

    const assetsDataArr = await getDatabaseRuntime().work((db) =>
      db("o_assets").whereIn("id", assetIds).select("id", "describe", "name", "type", "assetsId"),
    );
    const parentIds = assetsDataArr.map((item) => item.assetsId).filter((id) => id !== null);
    const parentAssetsData = await getDatabaseRuntime().work((db) =>
      db("o_assets")
        .leftJoin("o_image", "o_assets.imageId", "o_image.id")
        .whereIn("o_assets.id", parentIds as number[])
        .select("o_assets.id", "o_image.filePath", "o_assets.describe"),
    );
    assetsDataArr.forEach((i: any) => {
      const parent = parentAssetsData.find((item) => item.id === i.assetsId);
      if (parent) {
        i.parentDescribe = parent.describe;
      }
    });
    const imageUrlRecord: Record<number, string> = {};
    parentAssetsData.forEach((item) => {
      if (item.filePath) imageUrlRecord[item.id] = item.filePath;
    });
    const rolePrompt = u.getArtPrompt(projectSettingData!.artStyle!, "art_skills", "art_character_derivative");
    const toolPrompt = u.getArtPrompt(projectSettingData!.artStyle!, "art_skills", "art_prop_derivative");
    const scenePrompt = u.getArtPrompt(projectSettingData!.artStyle!, "art_skills", "art_scene_derivative");
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
    // 先批量为所有 assets 创建 image 记录并标记为"生成中"
    const imageIdMap: Record<number, number> = {};
    for (const item of assetsDataArr) {
      const [imageId] = await getDatabaseRuntime().work((db) =>
        db("o_image").insert({
          assetsId: item.id,
          type: item.type,
          state: "生成中",
          resolution: projectSettingData?.imageQuality,
          model: projectSettingData?.imageModel,
        }),
      );
      imageIdMap[item.id!] = imageId;
      await getDatabaseRuntime().work((db) => db("o_assets").where("id", item.id).update({ imageId: imageId }));
    }

    const imageData: { id: number; state: string; src: string }[] = [];
    res.status(200).send(success("开始生成资产图片"));
    const generateSingleAsset = async (item: any) => {
      const imageId = imageIdMap[item.id!];
      const typeConfig = promptRecord[item.type!] || promptRecord["role"];

      const { text } = await createDefaultConfiguredVendor().invokeText({
        target: { kind: "logical", key: "universalAi" },
        input: {
          system: `${typeConfig.prompt}`,
          messages: [
            {
              role: "user",
              content: `
            父级资产描述: ${item.parentDescribe || "无详细描述"}
            当前资产描述: ${item.describe || "无详细描述"}`,
            },
          ],
        },
      });
        await getDatabaseRuntime().work((db) => db("o_assets").where("id", item.id).update({ prompt: text }));

      const imageBase64 = imageUrlRecord[item.assetsId!] ? await u.oss.getImageBase64(imageUrlRecord[item.assetsId!]) : null;
      try {
        const repeloadObj = {
          prompt: text,
          size: projectSettingData?.imageQuality as "1K" | "2K" | "4K",
          aspectRatio: "16:9" as `${number}:${number}`,
        };
        const { vendorId, modelId } = parseVendorModelName(projectSettingData?.imageModel as `${string}:${string}`);
        const taskRecord = await u.task(projectId, "生成图片", modelId, {
          describe: "资产图片生成",
          content: JSON.stringify(repeloadObj),
        });
        let result: string;
        try {
          const vendor = createDefaultConfiguredVendor();
          const { version } = await vendor.inspectVendor(vendorId);
          const input = applyLegacyImageReferenceConversion(version, {
            referenceList: imageBase64 ? [{ type: "image", base64: imageBase64 }] : [],
            ...repeloadObj,
          });
          result = await vendor.generateImage({ target: { vendorId, modelId }, input });
          result = await normalizeHttpResult(result);
        } catch (e) {
          taskRecord(-1, u.error(e).message);
          throw new Error(u.error(e).message);
        }
        taskRecord(1);
        const savePath = `/${projectId}/assets/${scriptId}/${item.type}/${u.uuid()}.jpg`;
        await u.oss.writeFile(savePath, result);
        await getDatabaseRuntime().work((db) =>
          db("o_image").where({ id: imageId }).update({ state: "已完成", filePath: savePath }),
        );
        return {
          id: item.id!,
          state: "已完成",
          src: await u.oss.getSmallImageUrl(savePath),
        };
      } catch (e) {
        await getDatabaseRuntime().work((db) =>
          db("o_image")
            .where({ id: imageId })
            .update({ state: "生成失败", errorReason: u.error(e).message }),
        );
        return {
          id: item.id!,
          state: "生成失败",
          src: "",
        };
      }
    };

    // 按 concurrentCount 分批并发执行
    for (let i = 0; i < assetsDataArr.length; i += concurrentCount) {
      const batch = assetsDataArr.slice(i, i + concurrentCount);
      const batchResults = await Promise.all(batch.map(generateSingleAsset));
      imageData.push(...batchResults);
    }
  },
);
