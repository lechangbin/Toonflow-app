import express from "express";
import u from "@/utils";
import { z } from "zod";
import sharp from "sharp";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { Output, tool } from "ai";
import { urlToBase64 } from "@/utils/vm";
import { assetItemSchema } from "@/agents/productionAgent/tools";
const router = express.Router();
export type AssetData = z.infer<typeof assetItemSchema>;

export default router.post(
  "/",
  validateFields({
    storyboardIds: z.array(z.number()).optional(),
    projectId: z.number(),
    scriptId: z.number(),
    script: z.string(),
    scriptPlan: z.string(),
    storyboardTable: z.string(),
    assets: z.array(assetItemSchema),
  }),
  async (req, res) => {
    const {
      storyboardIds,
      projectId,
      scriptId,
      script,
      scriptPlan,
      storyboardTable,
      assets,
    }: {
      storyboardIds: number[];
      projectId: number;
      scriptId: number;
      script: string;
      scriptPlan: string;
      storyboardTable: string;
      assets: AssetData[];
    } = req.body;
    // 当没有 storyboardIds 时，通过 AI 生成新的分镜面板数据
    let finalStoryboardIds: number[] = storyboardIds || [];
    if (!storyboardIds || storyboardIds.length === 0) {
      await u.db("o_storyboard").where("scriptId", scriptId).delete();
      const createdIds: number[] = [];
      const resultTools = tool({
        description: "结果输出工具（必须调用）",
        inputSchema: z.object({
          items: z.array(
            z.object({
              title: z.string().describe("分镜名称"),
              description: z.string().describe("分镜详细描述"),
              relatedAssets: z.array(z.number()).describe("关联衍生资产id数组"),
              duration: z.number().describe("用于生成的视频时长（秒）"),
            }),
          ),
        }),
        execute: async (resData) => {
          console.log("%c Line:46 🌰 resData", "background:#93c0a4", resData.items);
          for (const item of resData.items) {
            const [id] = await u.db("o_storyboard").insert({
              title: item.title,
              description: item.description,
              scriptId: scriptId,
              duration: String(item.duration),
            });
            createdIds.push(id);
            if (item.relatedAssets.length === 0) continue;
            await u.db("o_assets2Storyboard").insert(item.relatedAssets.map((i) => ({ storyboardId: id, assetId: i })));
            console.log("%c Line:68 🍷 createdIds", "background:#33a5ff", createdIds);
          }
          return true;
        },
      });
      const { text } = await u.Ai.Text("universalAi").invoke({
        system: `你是一位专业的动画分镜师。你的任务是根据剧本内容、分镜表、拍摄计划和可用资产，拆分并生成完整的分镜面板数据。

## 工作流程
1. 仔细阅读剧本，理解故事情节、角色关系和情感节奏。
2. 参照分镜表和拍摄计划，确定每个分镜的镜头语言（景别、角度、运镜方式）。
3. 将可用资产合理分配到对应分镜中，确保每个分镜关联的资产与画面内容一致。
4. 为每个分镜撰写详细的画面描述，包含：场景环境、角色动作与表情、镜头构图、光影氛围。
5. 根据镜头内容合理分配视频时长（一般 2~8 秒，对话或动作复杂的场景可适当延长）。

## 输出要求
- 你 **必须** 调用 resultTools 工具来输出结果，不要在回复中添加任何文字说明。
- items 数组中每个元素包含：
  - title：简洁的分镜名称（如"开场远景"、"角色对话特写"）
  - description：详细的分镜画面描述（至少 50 字），需包含镜头景别、角色状态、环境氛围等具体视觉信息
  - relatedAssets：该分镜关联的衍生资产 ID 数组，仅关联与画面内容直接相关的资产
  - duration：建议视频时长（秒），根据画面复杂度和叙事节奏合理分配`,
        messages: [
          {
            role: "user",
            content: `## 剧本
${script}

## 分镜表
${storyboardTable}

## 拍摄计划
${scriptPlan}

## 可用资产列表
${assets.map((i) => i.derive.map((t) => `- 衍生资产名称: ${t.name} | 类型: ${t.type} | 资产ID: ${t.assetsId}`).join("\n")).join("\n")}`,
          },
        ],
        tools: { resultTools },
      });
      console.log("%c Line:52 🍢 text", "background:#93c0a4", text);
      finalStoryboardIds = createdIds;
    }
    await u.db("o_storyboard").whereIn("id", finalStoryboardIds).where("scriptId", scriptId).update({ state: "生成中" });
    console.log("%c Line:98 🍯 finalStoryboardIds", "background:#3f7cff", finalStoryboardIds);

    if (finalStoryboardIds.length === 0) {
      res.status(200).send(success());
      return;
    }

    const projectSettingData = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "artStyle").first();

    const sceneArkPrompt = u.getArtPrompt(projectSettingData?.artStyle || "", "art_storyboard");
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
          title: i.title,
          description: i.description,
          prompt: "",
          associateAssetsIds: assetRecord[i.id!],
          src: null,
          state: i.state,
        })),
      ),
    );
    for (const item of storyboardData) {
      const { text } = await u.Ai.Text("universalAi").invoke({
        system: `你是一位专业的 AI 绘画提示词工程师，擅长将分镜描述转化为高质量的图片生成提示词。

## 任务
根据分镜的标题与描述，结合项目美术风格要求，生成一段精准的英文图片生成提示词（Prompt）。

## 项目美术风格与提示词规范参考
${sceneArkPrompt || "（未指定特定美术风格，请根据分镜内容选择合适的画面风格）"}`,
        messages: [
          {
            role: "user",
            content: `分镜标题: ${item.title}\n分镜描述: ${item.description}`,
          },
        ],
      });
      console.log("%c Line:27 🍫 text", "background:#ffdd4d", text);

      const repeloadObj = {
        prompt: text,
        size: projectSettingData?.imageQuality as "1K" | "2K" | "4K",
        aspectRatio: "16:9" as `${number}:${number}`,
      };
      await u.db("o_storyboard").where("id", item.id).update({
        prompt: text,
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
