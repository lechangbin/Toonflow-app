import express from "express";
import u from "@/utils";
import * as zod from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { useSkill } from "@/utils/agent/skillsTools";
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
    await u.db("o_assets").where("id", assetsId).update({ promptState: "生成中" });

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

    const typeConfig: Record<string, { promptKey: string; itemType: ItemType; label: string; nameLabel: string }> = {
      role: { promptKey: "role-polish", itemType: "characters", label: "角色标准四视图", nameLabel: "角色" },
      scene: { promptKey: "scene-polish", itemType: "scenes", label: "场景图", nameLabel: "场景" },
      tool: { promptKey: "tool-polish", itemType: "props", label: "道具图", nameLabel: "道具" },
    };

    const config = typeConfig[type];
    if (!config) return res.status(500).send(error("不支持的类型"));

    findItemByName(result, name, config.itemType);
    const novelData = (await u.db("o_novel").whereIn("chapterIndex", [1]).select("*")) as NovelChapter[];
    const novelText = mergeNovelText(novelData);

    const skill = await useSkill("universal_agent.md");//todo：改为AI

    const systemPrompt = `${skill.prompt}

      请根据以下参数生成${config.label}提示词：
  
      **基础参数：**
      - 风格: ${project?.artStyle || "未指定"}
      - 小说类型: ${project?.type || "未指定"}
      - 小说背景: ${project?.intro || "未指定"}
  
      **${config.nameLabel}设定：**
      - ${config.nameLabel}名称:${name},
      - ${config.nameLabel}描述:${describe},
  
      请严格按照skill规范生成${type === "role" ? "人物角色四视图" : config.label}提示词。
      `;

    try {
      const { _output } = (await u.Ai.Text("universalAi").invoke({
        system: systemPrompt,
        messages: [{ role: "user", content: "小说原文" + novelText }],
        tools: skill.tools,
      })) as any;

      if (!_output) return res.status(500).send("失败");
      await u.db("o_assets").where("id", assetsId).update({ prompt: _output, promptState: "已完成" });

      res.status(200).send(success({ prompt: _output, assetsId }));
    } catch (e: any) {
      return res.status(500).send(error(e?.data?.error?.message ?? e?.message ?? "生成失败"));
    }
  },
);
