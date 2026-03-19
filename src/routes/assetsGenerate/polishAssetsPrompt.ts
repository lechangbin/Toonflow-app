import express from "express";
import u from "@/utils";
import * as zod from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
interface OutlineItem {
  description: string;
  name: string;
}

interface OutlineData {
  chapterRange: number[];
  characters?: OutlineItem[];
  props?: OutlineItem[];
  scenes?: OutlineItem[];
}

interface NovelChapter {
  id: number;
  reel: string;
  chapter: string;
  chapterData: string;
  projectId: number;
}

type ItemType = "characters" | "props" | "scenes";

interface ResultItem {
  type: ItemType;
  name: string;
  chapterRange: number[];
}
function findItemByName(items: ResultItem[], name: string, type?: ItemType): ResultItem | undefined {
  return items.find((item) => (!type || item.type === type) && item.name === name);
}
function mergeNovelText(novelData: NovelChapter[]): string {
  if (!Array.isArray(novelData)) return "";
  return novelData
    .map((chap) => {
      return `${chap.chapter.trim()}\n\n${chap.chapterData.trim().replace(/\r?\n/g, "\n")}\n`;
    })
    .join("\n");
}
//润色提示词
export default router.post(
  "/",
  validateFields({
    assetsId: zod.number(),
    projectId: zod.number(),
    type: zod.string(),
    name: zod.string(),
    describe: zod.string(),
  }),
  async (req, res) => {
    const { assetsId, projectId, type, name, describe } = req.body;
    //获取风格
    const project = await u.db("o_project").where("id", projectId).select("artStyle", "type", "intro").first();
    //如果没有找到对应的项目，返回错误
    if (!project) return res.status(500).send(success({ message: "项目为空" }));

    const allOutlineDataList: { data: string }[] = await u.db("o_outline").where("projectId", projectId).select("data");

    const itemMap: Record<string, ResultItem> = {};

    if (allOutlineDataList.length > 0)
      allOutlineDataList.forEach((row) => {
        const data: OutlineData = JSON.parse(row?.data || "{}");
        (["characters", "props", "scenes"] as ItemType[]).forEach((type) => {
          (data[type] || []).forEach((item) => {
            const key = `${type}-${item.name}`;
            if (!itemMap[key]) {
              itemMap[key] = {
                type,
                name: item.name,
                chapterRange: [...(data.chapterRange || [])],
              };
            } else {
              itemMap[key].chapterRange = Array.from(new Set([...itemMap[key].chapterRange, ...(data.chapterRange || [])]));
            }
          });
        });
      });

    const result: ResultItem[] = Object.values(itemMap);

    const role = (await u.getPrompts("role-polish")) ?? "";
    const scene = (await u.getPrompts("scene-polish")) ?? "";
    const tool = (await u.getPrompts("tool-polish")) ?? "";
    let systemPrompt = "";
    let userPrompt = "";
    if (type == "role") {
      const data = findItemByName(result, name, "characters");
      const chapterRange = Array.isArray(data?.chapterRange) ? data.chapterRange : [data?.chapterRange];
      const novelData = (await u.db("o_novel").whereIn("chapterIndex", [1]).select("*")) as NovelChapter[];
      const results: string = mergeNovelText(novelData);
      systemPrompt = role;
      userPrompt = `
      请根据以下参数生成角色标准四视图提示词：
  
      **基础参数：**
      - 风格: ${project?.artStyle || "未指定"}
      - 小说原文：${results || "未提供"}
      - 小说类型: ${project?.type || "未指定"}
      - 小说背景: ${project?.intro || "未指定"}
  
      **角色设定：**
      - 角色名称:${name},
      - 角色描述:${describe},
  
      请严格按照系统规范生成人物角色四视图提示词。
  
      `;
    }
    if (type == "scene") {
      const data = findItemByName(result, name, "scenes");

      const chapterRange = Array.isArray(data?.chapterRange) ? data.chapterRange : [data?.chapterRange];
      const novelData = (await u.db("o_novel").whereIn("chapterIndex", [1]).select("*")) as NovelChapter[];
      const results: string = mergeNovelText(novelData);
      systemPrompt = scene;
      userPrompt = `
      请根据以下参数生成场景图提示词：
  
      **基础参数：**
      - 风格: ${project?.artStyle || "未指定"}
      - 小说原文：${results || "未提供"}
      - 小说类型: ${project?.type || "未指定"}
      - 小说背景: ${project?.intro || "未指定"}
  
      **场景设定：**
      - 场景名称:${name},
      - 场景描述:${describe},
  
      请严格按照系统规范生成场景图提示词。
  
      `;
    }
    if (type == "tool") {
      const data = findItemByName(result, name, "props");
      const chapterRange = Array.isArray(data?.chapterRange) ? data.chapterRange : [data?.chapterRange];
      const novelData = (await u.db("o_novel").whereIn("chapterIndex", [1]).select("*")) as NovelChapter[];
      const results: string = mergeNovelText(novelData);
      systemPrompt = tool;
      userPrompt = `
      请根据以下参数生成道具图提示词：
  
      **基础参数：**
      - 风格: ${project?.artStyle || "未指定"}
      - 小说原文：${results || "未提供"}
      - 小说类型: ${project?.type || "未指定"}
      - 小说背景: ${project?.intro || "未指定"}
  
      **道具设定：**
      - 道具名称:${name},
      - 道具描述:${describe},
  
      请严格按照系统规范生成道具图提示词。
  
      `;
    }
    async function generatePrompt() {
      const result = await u.Ai.Text("assetsAi").invoke(
        {
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
        },
      )
      return result;

    }
    try {
      //添加到任务
      const { _output } = (await generatePrompt()) as any;
      if (_output) {
        await u.db("o_assets").where("id", assetsId).update({
          prompt: _output,
        });
      }
      if (!_output) return res.status(500).send("失败");

      res.status(200).send(success({ prompt: _output, assetsId }));
    } catch (e: any) {
      return res.status(500).send(error(e?.data?.error?.message ?? e?.message ?? "生成失败"));
    }
  },
);
