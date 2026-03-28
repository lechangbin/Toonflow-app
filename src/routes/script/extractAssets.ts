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

/** 按批次并发执行，每批 batchSize 个同时跑，批次完成后调用 onBatchDone */
async function pMapBatch<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  batchSize: number,
  onBatchDone?: (batchResults: R[]) => Promise<void>,
): Promise<R[]> {
  const allResults: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    allResults.push(...batchResults);
    if (onBatchDone) await onBatchDone(batchResults);
  }
  return allResults;
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
    const intansce = u.Ai.Text("universalAi");
    const novelData = await u.db("o_novel").where("projectId", projectId).select("chapterData");
    if (!novelData || novelData.length === 0) return res.status(400).send(error("请先上传小说"));
    await u.db("o_script").whereIn("id", scriptIds).update({
      extractState: 0,
    });
    // 构建 scriptId -> script 内容的映射
    const scriptMap = new Map(scripts.map((s: o_script) => [s.id, s]));

    const errors: { scriptId: number; error: string }[] = [];
    let successCount = 0;

    // 每批提取结果：scriptId -> 资产列表
    type BatchResult = { scriptId: number; assets: Asset[] } | null;

    /** 一批剧本提取完成后统一入库并建立关联 */
    async function persistBatch(batchResults: BatchResult[]) {
      const validResults = batchResults.filter((r): r is { scriptId: number; assets: Asset[] } => r !== null && r.assets.length > 0);
      if (!validResults.length) return;

      // 合并本批所有资产，同名去重
      const mergedAssetsMap = new Map<string, Asset>();
      const assetScriptIds = new Map<string, number[]>();
      for (const { scriptId, assets } of validResults) {
        for (const asset of assets) {
          if (!mergedAssetsMap.has(asset.name)) {
            mergedAssetsMap.set(asset.name, asset);
          }
          const ids = assetScriptIds.get(asset.name) || [];
          ids.push(scriptId);
          assetScriptIds.set(asset.name, ids);
        }
      }

      // 查询已有资产，避免重复插入
      const existingAssets = await u.db("o_assets").where("projectId", projectId).select("id", "name");
      const existingMap = new Map(existingAssets.map((a) => [a.name!, a.id!]));

      // 插入不存在的资产
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

      // 重新查询获取完整的 name -> id 映射
      const allAssets = await u.db("o_assets").where("projectId", projectId).select("id", "name");
      const nameToId = new Map(allAssets.map((a) => [a.name, a.id]));

      // 建立本批各 scriptId 与资产的关联
      const batchScriptIds = validResults.map((r) => r.scriptId);
      const scriptAssetRows: { scriptId: number; assetId: number }[] = [];
      for (const [name, sIds] of assetScriptIds) {
        const assetId = nameToId.get(name);
        if (assetId) {
          for (const sid of sIds) {
            scriptAssetRows.push({ scriptId: sid, assetId });
          }
        }
      }

      // 先删除本批 scriptId 的旧关联，再插入新的
      await u.db("o_scriptAssets").whereIn("scriptId", batchScriptIds).delete();
      if (scriptAssetRows.length) {
        await u.db("o_scriptAssets").insert(scriptAssetRows);
      }

      // 本批成功的剧本状态更新为 1（成功）
      await u.db("o_script").whereIn("id", batchScriptIds).update({
        extractState: 1,
        errorReason: null,
      });
    }

    // 按批次并发提取剧本资产，每批完成后统一入库
    await pMapBatch<number, BatchResult>(
      scriptIds,
      async (scriptId: number) => {
        const script = scriptMap.get(scriptId);
        if (!script) {
          errors.push({ scriptId, error: "未找到对应剧本" });
          await u.db("o_script").where("id", scriptId).update({ extractState: -1, errorReason: "未找到对应剧本" });
          return null;
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
          const skill = await useSkill("universal_agent.md");//todo：改为AI
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
          await u.db("o_script").where("id", scriptId).update({ extractState: -1, errorReason: u.error(e).message });
          return null;
        }

        if (!collected.length) {
          errors.push({ scriptId, error: "AI 未返回任何资产" });
          await u.db("o_script").where("id", scriptId).update({ extractState: -1, errorReason: "AI 未返回任何资产" });
          return null;
        }

        successCount++;
        return { scriptId, assets: collected };
      },
      concurrency,
      persistBatch,
    );

    return res.send(success("开始提取资产"));
  },
);
