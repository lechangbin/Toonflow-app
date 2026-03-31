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
      // @ts-ignore
      .where("o_assets.id", "in", assetIds)
      .whereNull("o_assets.assetsId")
      .where("o_assets.projectId", projectId);
    let childAssetsData = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .select("o_assets.*", "o_image.filePath")
      .where("o_assets.projectId", projectId)
      // @ts-ignore
      .where("o_assets.id", "in", assetIds)
      .whereNotNull("o_assets.assetsId");

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
          videoList: [],
        },
        //todo：矫正封面数据
        poster: {
          items: [],
        },
      };
      return res.status(200).send(success(flowData));
    } else {
      try {
        const storyboardData = await u.db("o_storyboard").where("scriptId", episodesId);
        await Promise.all(
          storyboardData.map(async (i) => {
            if (i.filePath) {
              try {
                i.filePath = await u.oss.getFileUrl(i.filePath);
              } catch {
                i.filePath = "";
              }
            } else {
              i.filePath = "";
            }
          }),
        );
        const storyboardIds = storyboardData.map((i) => i.id);
        const assetsIds = await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds);
        const assets2StoryboardMap: Record<number, number[]> = {};
        assetsIds.forEach((i) => {
          if (!assets2StoryboardMap[i.storyboardId!]) {
            assets2StoryboardMap[i.storyboardId!] = [];
          }
          assets2StoryboardMap[i.storyboardId!].push(i.assetId!);
        });
        const flowData = JSON.parse(sqlData!.data ?? "{}");
        // 将原有 flowData.assets 按 id 建立索引，以便后续合并保留旧字段
        const existingAssetsMap: Record<number, any> = {};
        if (Array.isArray(flowData.assets)) {
          flowData.assets.forEach((a: any) => {
            existingAssetsMap[a.id] = a;
          });
        }
        flowData.assets = await Promise.all(
          assetsData.map(async (item) => {
            const existing = existingAssetsMap[item.id] ?? {};
            // 将原有 derive 按 id 建立索引
            const existingDeriveMap: Record<number, any> = {};
            if (Array.isArray(existing.derive)) {
              existing.derive.forEach((d: any) => {
                existingDeriveMap[d.id] = d;
              });
            }
            return {
              ...existing,
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
                    ...(existingDeriveMap[child.id] ?? {}),
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
            };
          }),
        );
        // 将数据库 storyboardData 按 id 建立索引
        const dbStoryboardMap: Record<number, (typeof storyboardData)[number]> = {};
        storyboardData.forEach((i) => {
          dbStoryboardMap[i.id!] = i;
        });

        // 用于构造单条 storyboard 的辅助函数
        const buildStoryboardItem = (i: (typeof storyboardData)[number], existing: any = {}) => ({
          ...existing,
          id: i.id,
          index: i.index,
          duration: i.duration ? +i.duration : 0,
          prompt: i.prompt,
          associateAssetsIds: assets2StoryboardMap[i.id!] ?? [],
          src: i.filePath,
          state: i.state,
        });

        // 保持旧数据顺序，新增的追加到最后
        const usedIds = new Set<number>();
        const orderedStoryboard: any[] = [];

        // 1. 按旧数据顺序遍历，若数据库中仍存在则合并更新
        if (Array.isArray(flowData.storyboard)) {
          flowData.storyboard.forEach((s: any) => {
            const dbItem = dbStoryboardMap[s.id];
            if (dbItem) {
              orderedStoryboard.push(buildStoryboardItem(dbItem, s));
              usedIds.add(s.id);
            }
          });
        }

        // 2. 数据库中新增的（旧数据中没有的）追加到最后
        storyboardData.forEach((i) => {
          if (!usedIds.has(i.id!)) {
            orderedStoryboard.push(buildStoryboardItem(i));
          }
        });
        flowData.storyboard = orderedStoryboard.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        res.status(200).send(success(flowData));
      } catch (err) {
        res.status(400).send(error());
      }
    }
  },
);
