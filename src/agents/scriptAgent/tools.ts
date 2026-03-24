import { tool, Tool } from "ai";
import u from "@/utils";
import { z } from "zod";
import _ from "lodash";
import ResTool from "@/socket/resTool";

export const AssetSchema = z.object({
  id: z.number().describe("衍生资产ID,如果新增则为空").optional(),
  assetsId: z.string().describe("关联的资产ID"),
  prompt: z.string().describe("生成提示词"),
  name: z.string().describe("衍生资产名称"),
  desc: z.string().describe("衍生资产描述"),
  src: z.string().describe("衍生资产资源路径").optional(),
  state: z.enum(["未生成", "生成中", "已完成", "生成失败"]).describe("衍生资产生成状态，新增默认未生成"),
  type: z.enum(["role", "tool", "scene", "clip"]).describe("衍生资产类型"),
});
export const ScriptSchema = z.object({
  id: z.number().describe("剧本ID,如果新增则为空").optional(),
  name: z.string().describe("剧本名称"),
  content: z.string().describe("剧本内容"),
});
export const planData = z.object({
  storySkeleton: z.string().describe("故事骨架"),
  adaptationStrategy: z.string().describe("改编策略"),
  script: z.string().describe("剧本内容"),
});

export type planData = z.infer<typeof planData>;

const keySchema = z.enum(Object.keys(planData.shape) as [keyof planData, ...Array<keyof planData>]);
const planDataKeyLabels = Object.fromEntries(
  Object.entries(planData.shape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).description ?? key]),
) as Record<keyof planData, string>;

export default (resTool: ResTool, toolsNames?: string[]) => {
  const { socket } = resTool;
  const tools: Record<string, Tool> = {
    get_novel_events: tool({
      description: "获取章节事件",
      inputSchema: z.object({
        ids: z.array(z.number()).describe("章节id"),
      }),
      execute: async ({ ids }) => {
        resTool.systemMessage(`正在阅读 章节事件 数据...`);
        console.log("[tools] get_novel_events", ids);
        const data = await u
          .db("o_novel")
          .select("id", "chapterIndex as index", "reel", "chapter", "chapterData", "event", "eventState")
          .whereIn("id", ids);
        const eventString = data.map((i: any) => [`第${i.index}章，标题：${i.chapter}，事件：${i.event}`].join("\n")).join("\n");
        return eventString;
      },
    }),
    get_planData: tool({
      description: "获取工作区数据",
      inputSchema: z.object({
        key: keySchema.describe("数据key"),
      }),
      execute: async ({ key }) => {
        resTool.systemMessage(`正在阅读 ${planDataKeyLabels[key]} 数据...`);
        console.log("[tools] get_planData", key);
        const planData: planData = await new Promise((resolve) => socket.emit("getPlanData", { key }, (res: any) => resolve(res)));
        return planData[key];
      },
    }),
    get_novel_text: tool({
      description: "获取小说章节原始文本内容",
      inputSchema: z.object({
        id: z.string().describe("章节id"),
      }),
      execute: async ({ id }) => {
        console.log(id);
        return "";
      },
    }),
    set_planData_storySkeleton: tool({
      description: "保存故事骨架到工作区",
      inputSchema: z.object({ value: planData.shape.storySkeleton }),
      execute: async ({ value }) => {
        console.log("[tools] set_planData storySkeleton", value);
        resTool.systemMessage("正在保存 故事骨架 数据");
        socket.emit("setPlanData", { key: "storySkeleton", value });
        return true;
      },
    }),
    set_planData_adaptationStrategy: tool({
      description: "保存改编策略到工作区",
      inputSchema: z.object({ value: planData.shape.adaptationStrategy }),
      execute: async ({ value }) => {
        console.log("[tools] set_planData adaptationStrategy", value);
        resTool.systemMessage("正在保存 改编策略 数据");
        socket.emit("setPlanData", { key: "adaptationStrategy", value });
        return true;
      },
    }),
    insert_script_to_sqlite: tool({
      description: "将剧本内容插入sqlite数据库，供后续业务使用",
      inputSchema: z.object({
        script: ScriptSchema,
        assetsList: z.array(AssetSchema).describe("剧本所使用资产列表"),
      }),
      execute: async ({ assetsList, script }) => {
        console.log("%c Line:103 🍷 script", "background:#42b983", script);
        console.log("[tools] insert_script_to_sqlite", assetsList);
        const [scriptId] = await u.db("o_script").insert({
          name: script.name,
          content: script.content,
          projectId: resTool.data.projectId,
          createTime: Date.now(),
        });
        if (assetsList && assetsList.length) {
          const assetId = [];
          for (const i of assetsList) {
            const [id] = await u.db("o_assets").insert({
              name: i.name,
              prompt: i.prompt,
              type: i.type,
              describe: i.desc,
              projectId: resTool.data.projectId,
              state: "未生成",
            });
            assetId.push(id);
          }

          await u.db("o_scriptAssets").insert(assetId.map((i) => ({ scriptId, assetId: i })));
        }
        socket.emit("setPlanData", { key: "script", value: scriptId });
        return true;
      },
    }),
  };

  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([n]) => toolsNames.includes(n))) : tools;
};
