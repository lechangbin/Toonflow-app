import express from "express";
import u from "@/utils";
import pLimit from "p-limit";
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
    items: zod.array(
      zod.object({
        assetsId: zod.number(),
        type: zod.string(),
        name: zod.string(),
        describe: zod.string(),
      }),
    ),
    projectId: zod.number(),
    concurrentCount: zod.number().int().min(1).optional(),
  }),
  async (req, res) => {
    const { projectId, items, concurrentCount } = req.body;
    //获取风格
    const project = await u.db("o_project").where("id", projectId).select("artStyle", "type", "intro").first();
    //如果没有找到对应的项目，返回错误
    if (!project) return res.status(500).send(success({ message: "项目为空" }));

    // 预加载公共数据
    const allOutlineDataList: { data: string }[] = await u.db("o_outline").where("projectId", projectId).select("data");
    const itemMap: Record<string, ResultItem> = {};
    if (allOutlineDataList.length > 0)
      allOutlineDataList.forEach((row) => {
        const data: OutlineData = JSON.parse(row?.data || "{}");
        (["characters", "props", "scenes"] as ItemType[]).forEach((type) => {
          (data[type] || []).forEach((item) => {
            const key = `${type}-${item.name}`;
            if (!itemMap[key]) {
              itemMap[key] = { type, name: item.name, chapterRange: [...(data.chapterRange || [])] };
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

    const novelData = (await u.db("o_novel").whereIn("chapterIndex", [1]).select("*")) as NovelChapter[];
    const novelText = mergeNovelText(novelData);
    const skill = await useSkill("universal_agent.md");//todo：改为AI

    // 批量更新所有 item 状态为生成中
    const assetsIds = items.map((item: { assetsId: number }) => item.assetsId);
    await u.db("o_assets").whereIn("id", assetsIds).update({ promptState: "生成中" });

    // 后台异步并发生成，不阻塞响应
    const limit = pLimit(concurrentCount ?? 1);

    const tasks = items.map((item: { assetsId: number; type: string; name: string; describe: string }) =>
      limit(async () => {
        const config = typeConfig[item.type];
        if (!config) return;

        findItemByName(result, item.name, config.itemType);

        const systemPrompt = `${skill.prompt}

      请根据以下参数生成${config.label}提示词：
  
      **基础参数：**
      - 风格: ${project?.artStyle || "未指定"}
      - 小说类型: ${project?.type || "未指定"}
      - 小说背景: ${project?.intro || "未指定"}
  
      **${config.nameLabel}设定：**
      - ${config.nameLabel}名称:${item.name},
      - ${config.nameLabel}描述:${item.describe},
  
      请严格按照skill规范生成${item.type === "role" ? "人物角色四视图" : config.label}提示词。
      `;

        try {
          const { _output } = (await u.Ai.Text("universalAgent").invoke({
            system: systemPrompt,
            messages: [{ role: "user", content: "小说原文" + novelText }],
            tools: skill.tools,
          })) as any;

          if (!_output) {
            await u.db("o_assets").where("id", item.assetsId).update({ promptState: "生成失败" });
            return;
          }

          await u.db("o_assets").where("id", item.assetsId).update({ prompt: _output, promptState: "已完成" });
        } catch (e: any) {
          await u.db("o_assets").where("id", item.assetsId).update({ promptState: "生成失败" });
        }
      }),
    );

    // 后台执行，不等待结果
    Promise.all(tasks).catch(() => {});

    return res.status(200).send(success({ total: items.length }));
  },
);
