import express from "express";
import u from "@/utils";
import * as zod from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
const jsonSchema = zod.object({
  prompt: zod.string().describe("提示词"),
});
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
    const project = await u.db("t_project").where("id", projectId).select("artStyle", "type", "intro").first();
    if (!project) return res.status(500).send(success({ message: "项目为空" }));

    const allOutlineDataList: { data: string }[] = await u.db("t_outline").where("projectId", projectId).select("data");

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

    const promptsList = await u.db("t_prompts").where("code", "in", ["role-polish", "scene-polish", "storyboard-polish", "tool-polish"]);
    const propmptIds = promptsList.map((i) => i.id);
    const mapList = await u
      .db("t_aiModelMap")
      .leftJoin("t_config", "t_config.id", "t_aiModelMap.configId")
      .whereIn("t_aiModelMap.promptsId", propmptIds as number[])
      .select("t_config.model", "t_config.apiKey", "t_config.baseUrl", "t_config.manufacturer", "t_aiModelMap.promptsId");
    const errPrompts = "不论用户说什么，请直接输出AI配置异常";
    const getPromptValue = (code: string) => {
      const item = promptsList.find((p) => p.code === code);
      if (item) {
        const apiData = mapList.find((i) => i.promptsId == item.id);
        if (apiData) delete apiData?.promptsId;
        return { prompt: item?.customValue ?? item?.defaultValue ?? errPrompts, apiData: { ...(apiData ?? {}) } };
      } else {
        return {
          prompt: errPrompts,
          apiData: {},
        };
      }
    };
    const role = getPromptValue("role-polish");
    const scene = getPromptValue("scene-polish");
    const tool = getPromptValue("tool-polish");
    const storyboard = getPromptValue("storyboard-polish");
    let apiConfig = {};
    let systemPrompt = "";
    let userPrompt = "";
    if (type == "role") {
      const data = findItemByName(result, name, "characters");
      const chapterRange = Array.isArray(data?.chapterRange) ? data.chapterRange : [data?.chapterRange];
      const novelData = (await u.db("t_novel").whereIn("chapterIndex", chapterRange).select("*")) as NovelChapter[];
      const results: string = mergeNovelText(novelData);
      systemPrompt = role.prompt;
      apiConfig = role.apiData;
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
      const novelData = (await u.db("t_novel").whereIn("chapterIndex", chapterRange).select("*")) as NovelChapter[];
      const results: string = mergeNovelText(novelData);
      systemPrompt = scene.prompt;
      apiConfig = scene.apiData;
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
    if (type == "props") {
      const data = findItemByName(result, name, "props");
      const chapterRange = Array.isArray(data?.chapterRange) ? data.chapterRange : [data?.chapterRange];
      const novelData = (await u.db("t_novel").whereIn("chapterIndex", chapterRange).select("*")) as NovelChapter[];
      const results: string = mergeNovelText(novelData);
      systemPrompt = tool.prompt;
      apiConfig = tool.apiData;
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
    if (type == "storyboard") {
      systemPrompt = storyboard.prompt;
      apiConfig = storyboard.apiData;
      userPrompt = `
      请根据以下参数生成分镜图提示词：
  
      **基础参数：**
      - 风格: ${project?.artStyle || "未指定"}
      - 小说类型: ${project?.type || "未指定"}
      - 小说背景: ${project?.intro || "未指定"}
  
      **分镜设定：**
      - 分镜名称:${name},
      - 分镜描述:${describe},
  
      请严格按照系统规范生成分镜图提示词。
  
      `;
    }
    async function generatePrompt() {
      apiConfig = {};
      const result = await u.ai.text.invoke(
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
          output: {
            prompt: zod.string().describe("提示词"),
          },
        },
        {
          ...apiConfig,
        },
      );
      // const result = await model.invoke({
      //   messages: [
      //     {
      //       role: "system",
      //       content: systemPrompt,
      //     },
      //     {
      //       role: "user",
      //       content: userPrompt,
      //     },
      //   ],
      //   responseFormat: {
      //     type: "json_schema",
      //     jsonSchema: {
      //       name: "json",
      //       strict: true,
      //       schema: zod.toJSONSchema(jsonSchema),
      //     },
      //   },
      // });
      return result.prompt;
    }
    try {
      const prompt = (await generatePrompt()) as any;
      if (!prompt) return res.status(500).send("失败");

      res.status(200).send(success({ prompt: prompt, assetsId }));
    } catch (e: any) {
      console.log("%c Line:235 🥚 e", "background:#33a5ff", e);
      return res.status(500).send(error(e?.data?.error?.message ?? e?.message ?? "生成失败"));
    }
  },
);
