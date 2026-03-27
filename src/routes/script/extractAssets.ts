import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { useSkill } from "@/utils/agent/skillsTools";
import { tool } from "ai";
import { o_script } from "@/types/database";

const router = express.Router();
export const AssetSchema = z.object({
  prompt: z.string().describe("生成提示词"),
  name: z.string().describe("资产名称,仅为名称不做其他任何表述"),
  desc: z.string().describe("资产描述"),
  type: z.enum(["role", "tool", "scene"]).describe("资产类型"),
});

type Asset = z.infer<typeof AssetSchema>;

/** 控制并发的辅助函数 */
async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export default router.post(
  "/",
  validateFields({
    scriptIds: z.array(z.number()),
    projectId: z.number(),
    concurrency: z.number().min(1).max(20).optional(),
  }),
  async (req, res) => {
    const { scriptIds, projectId, concurrency = 3 } = req.body;
    if (!scriptIds.length) return res.status(400).send(error("请先选择剧本"));
    const scripts = await u.db("o_script").whereIn("id", scriptIds);
    const intansce = u.Ai.Text("universalAgent");
    const novelData = await u.db("o_novel").where("projectId", projectId).select("chapterData");
    if (!novelData || novelData.length === 0) return res.status(400).send(error("请先上传小说"));

    // 每个 scriptId 对应提取出的资产列表
    const scriptAssetsMap = new Map<number, Asset[]>();

    // 构建 scriptId -> script 内容的映射
    const scriptMap = new Map(scripts.map((s: o_script) => [s.id, s]));

    const errors: { scriptId: number; error: string }[] = [];

    // 并发提取所有剧本的资产，每个剧本单独跑一次 AI
    await pMap(
      scriptIds,
      async (scriptId: number) => {
        const script = scriptMap.get(scriptId);
        if (!script) {
          errors.push({ scriptId, error: "未找到对应剧本" });
          return;
        }

        // 用闭包收集当前 scriptId 的资产
        let collected: Asset[] = [];

        const resultTool = tool({
          description: "返回结果时必须调用这个工具,",
          inputSchema: z.object({
            assetsList: z.array(AssetSchema).describe("剧本所使用资产列表,注意不要包含剧本内容,仅为所使用到的 道具、人物、场景、素材"),
          }),
          execute: async ({ assetsList }) => {
            console.log("[tools] set_flowData script", assetsList);
            if (assetsList && assetsList.length) {
              collected = assetsList;
            }
            return true;
          },
        });

        try {
          const skill = await useSkill("universal_agent.md");
          await intansce.invoke({
            messages: [
              {
                role: "system",
                content:
                  skill.prompt +
                  "\n\n提取剧本中涉及的资产（角色、场景、道具），参考技能 script_assets_extract 规范，结果必须通过 resultTool 工具返回。",
              },
              {
                role: "user",
                content: `请根据以下剧本提取对应的剧本资产（角色、场景、道具、素材片段）:\n\n${script.content}`,
              },
            ],
            tools: { ...skill.tools, resultTool },
          });
        } catch (e: any) {
          const msg = e?.message || String(e);
          console.error(`[extractAssets] scriptId=${scriptId} name=${script.name} 提取失败:`, msg);
          errors.push({ scriptId, error: script.name + ":" + u.error(e).message });
          return;
        }

        if (!collected.length) {
          errors.push({ scriptId, error: "AI 未返回任何资产" });
          return;
        }

        scriptAssetsMap.set(scriptId, collected);
      },
      concurrency,
    );

    // 如果全部失败，直接返回错误
    if (!scriptAssetsMap.size) {
      return res.status(500).send(error("所有剧本资产提取均失败", errors));
    }

    // 按 name 合并所有资产，同名资产只保留第一个
    const mergedAssetsMap = new Map<string, Asset>();
    // 同时记录每个资产名称关联的 scriptId 列表
    const assetScriptIds = new Map<string, number[]>();

    for (const [scriptId, assets] of scriptAssetsMap) {
      for (const asset of assets) {
        if (!mergedAssetsMap.has(asset.name)) {
          mergedAssetsMap.set(asset.name, asset);
        }
        const ids = assetScriptIds.get(asset.name) || [];
        ids.push(scriptId);
        assetScriptIds.set(asset.name, ids);
      }
    }

    // 一次性查询数据库中已有的资产
    const existingAssets = await u.db("o_assets").where("projectId", projectId).select("id", "name");
    const existingMap = new Map(existingAssets.map((a) => [a.name!, a.id!]));

    // 批量插入不存在的资产
    const toInsert = [...mergedAssetsMap.values()].filter((asset) => !existingMap.has(asset.name));
    if (toInsert.length) {
      await u.db("o_assets").insert(
        toInsert.map((asset) => ({
          name: asset.name,
          prompt: asset.prompt,
          type: asset.type,
          describe: asset.desc,
          projectId: projectId,
          startTime: Date.now(),
        })),
      );
    }

    // 重新查询所有资产，获取完整的 name -> id 映射
    const allAssets = await u.db("o_assets").where("projectId", projectId).select("id", "name");
    const nameToId = new Map(allAssets.map((a) => [a.name, a.id]));

    // 批量建立 scriptId <-> assetId 的关联
    const scriptAssetRows: { scriptId: number; assetId: number }[] = [];
    for (const [name, sIds] of assetScriptIds) {
      const assetId = nameToId.get(name);
      if (assetId) {
        for (const sid of sIds) {
          scriptAssetRows.push({ scriptId: sid, assetId });
        }
      }
    }
    await u.db("o_scriptAssets").whereIn("scriptId", scriptIds).delete();
    if (scriptAssetRows.length) {
      await u.db("o_scriptAssets").insert(scriptAssetRows);
    }

    return res.send(success(errors.length ? `部分剧本资产提取失败\n${errors.map((i) => i.error).join("\n")}` : "资产提取完成"));
  },
);
