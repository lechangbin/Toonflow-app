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
      const createdIds: number[] = [];
      const resultTools = tool({
        description: "结果输出工具（必须调用）",
        inputSchema: z.object({
          items: z.array(
            z.object({
              title: z.string().describe("分镜名称"),
              description: z.string().describe("分镜详细描述"),
              relatedAssets: z.array(z.number()).describe("关联衍生资产id数组"),
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
        system: `
        你需要根据用户提供的剧本、分镜表、拍摄计划和资产列表，来生成一个分镜面板，内容结构为 [{title:"分镜名称",description:"分镜详细描述",relatedAssets:关联衍生资产id}]。
        你必须调用 resultTools 来输出结果，传入的参数需要包含 items 字段，items 是一个数组，每个元素包含 title（分镜名称）,description（分镜详细描述）,relatedAssets（关联衍生资产id数组）。请直接输出调用工具的代码，不要做任何多余的描述性文字，必须等待工具调用完成。调用工具后你本身的回复 请保持空白，不要添加任何内容。`,
        messages: [
          {
            role: "user",
            content: `
          ====== 剧本 ======
        ${script}
        ====== 分镜表 ======
        ${storyboardTable}
        ====== 拍摄计划 ======
        ${scriptPlan}
        ====== 资产列表 ======
        ${assets.map((i) => i.derive.map((t) => `衍生资产名称:${t.name},衍生资产类型:${t.type},关联资产ID:${t.assetsId}`).join("\n")).join("\n")}
          `,
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
        system: `
        你需要根据用户提供的分镜的标题与描述，结合当前项目的美术风格，为我生成一段提示词以便生成更符合项目美术风格的分镜图片。直接输出提示词，不做任何解释说明。
        美术风格：${sceneArkPrompt}`,
        messages: [
          {
            role: "user",
            content: `分镜描述:${item.description}`,
          },
        ],
      });
      console.log("%c Line:27 🍫 text", "background:#ffdd4d", text);

      const repeloadObj = {
        prompt: text,
        size: projectSettingData?.imageQuality as "1K" | "2K" | "4K",
        aspectRatio: "16:9",
      };
      await u.db("o_storyboard").where("id", item.id).update({
        prompt: text,
        state: "生成中",
      });
      u.Ai.Image(projectSettingData?.imageModel as `${string}:${string}`)
        .run({
          prompt: text,
          imageBase64: await getAssetsImageBase64(assetRecord[item.id!] || []),
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
