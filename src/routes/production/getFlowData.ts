import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
import { FlowData } from "@/agents/productionAgent/tools";

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
  }),
  async (req, res) => {
    const { projectId, episodesId }: { projectId: number; episodesId: number } = req.body;
    const sqlData = await u
      .db("o_agentWorkData")
      .where("projectId", String(projectId))
      .andWhere("episodesId", String(episodesId))
      .select("data")
      .first();

    const scriptData = await u.db("o_script").where("projectId", projectId).where("id", episodesId).first();
    const scriptAssets = await u.db("o_scriptAssets").where("scriptId", episodesId);
    const assetIds = scriptAssets.map((i) => i.assetId);
    const assetsData = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .select("o_assets.*", "o_image.filePath")
      .where("o_assets.id", "in", assetIds)
      .whereNull("o_assets.assetsId")
      .where("o_assets.projectId", projectId);
    let childAssetsData = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .select("o_assets.*", "o_image.filePath")
      .where("o_assets.projectId", projectId)
      .where("o_assets.id", "in", assetIds)
      .whereNotNull("o_assets.assetsId");
    console.log("%c Line:35 🥚 childAssetsData", "background:#f5ce50", childAssetsData);

    if (!sqlData) {
      const flowData: FlowData = {
        script: scriptData?.content ?? "",
        scriptPlan: "",
        assets: await Promise.all(
          assetsData.map(async (item) => ({
            id: item.id,
            name: item.name ?? "",
            type: item.type ?? "",
            prompt: item.prompt ?? "",
            desc: item.describe ?? "",
            src: item.filePath && (await u.oss.getFileUrl(item.filePath!)),
            derive: await Promise.all(
              childAssetsData
                .filter((child) => child.assetsId === item.id)
                .map(async (child) => ({
                  id: child.id,
                  assetsId: item.id,
                  name: child.name ?? "",
                  type: child.type,
                  prompt: child.prompt,
                  desc: child.describe ?? "",
                  src: child.filePath && (await u.oss.getFileUrl(child.filePath!)),
                  state: child.state ?? "未生成", //todo：矫正状态值
                })),
            ),
          })),
        ),
        storyboardTable: "",
        storyboard: [],
        //todo：矫正workbench数据
        workbench: {
          name: scriptData?.name ?? "",
          duration: "01:03",
          resolution: "1920×1080",
          fps: "30fps",
          gradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        },
        //todo：矫正封面数据
        poster: {
          items: [],
        },
      };
      return res.status(200).send(success(flowData));
    } else {
      try {
        const flowData = JSON.parse(sqlData!.data ?? "{}");
        flowData.assets = await Promise.all(
          assetsData.map(async (item) => ({
            id: item.id,
            name: item.name ?? "",
            type: item.type ?? "",
            prompt: item.prompt ?? "",
            desc: item.describe ?? "",
            src: item.filePath && (await u.oss.getFileUrl(item.filePath!)),
            derive: await Promise.all(
              childAssetsData
                .filter((child) => child.assetsId === item.id)
                .map(async (child) => ({
                  id: child.id,
                  assetsId: item.id,
                  name: child.name ?? "",
                  prompt: child.prompt,
                  type: child.type,
                  desc: child.describe ?? "",
                  src: child.filePath && (await u.oss.getFileUrl(child.filePath!)),
                  state: child.state ?? "未生成", //todo：矫正状态值
                })),
            ),
          })),
        );
        res.status(200).send(success(flowData));
      } catch (err) {
        res.status(200).send(error());
      }
    }
  },
);
