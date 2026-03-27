import { tool, Tool } from "ai";
import u from "@/utils";
import { z } from "zod";
import _ from "lodash";
import ResTool from "@/socket/resTool";

export const AssetSchema = z.object({
  id: z.number().describe("资产ID,如果新增则为空").optional(),
  prompt: z.string().describe("生成提示词"),
  name: z.string().describe("资产名称"),
  desc: z.string().describe("资产描述"),
  type: z.enum(["role", "tool", "scene", "clip"]).describe("资产类型"),
});
export const ScriptSchema = z.object({
  id: z.number().describe("剧本ID"),
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

interface ToolConfig {
  resTool: ResTool;
  toolsNames?: string[];
  msg: ReturnType<ResTool["newMessage"]>;
}

export default (toolCpnfig: ToolConfig) => {
  const { resTool, toolsNames, msg } = toolCpnfig;
  const { socket } = resTool;
  const tools: Record<string, Tool> = {
    get_novel_events: tool({
      description: "获取章节事件",
      inputSchema: z.object({
        ids: z.array(z.number()).describe("章节id，注意区分"),
      }),
      execute: async ({ ids }) => {
        console.log("[tools] get_novel_events", ids);
        const thinking = msg.thinking("正在查询章节事件...");
        const data = await u
          .db("o_novel")
          .where("projectId", resTool.data.projectId)
          .select("id", "chapterIndex as index", "reel", "chapter", "chapterData", "event", "eventState")
          .whereIn("id", ids);
        thinking.appendText("正在查询章节ID: " + ids.join(","));
        const eventString = data.map((i: any) => [`第${i.index}章，标题：${i.chapter}，事件：${i.event}`].join("\n")).join("\n");
        thinking.appendText("查询结果:\n" + eventString);
        thinking.updateTitle("查询章节事件完成");
        thinking.complete();
        return eventString;
      },
    }),
    get_planData: tool({
      description: "获取工作区数据",
      inputSchema: z.object({
        key: keySchema.describe("数据key"),
      }),
      execute: async ({ key }) => {
        console.log("[tools] get_planData", key);
        const thinking = msg.thinking(`正在获取${planDataKeyLabels[key]}工作区数据...`);
        const planData: planData = await new Promise((resolve) => socket.emit("getPlanData", { key }, (res: any) => resolve(res)));
        thinking.appendText(`获取到${planDataKeyLabels[key]}:\n` + planData[key]);
        thinking.updateTitle(`获取${planDataKeyLabels[key]}完成`);
        thinking.complete();
        return planData[key];
      },
    }),
    get_novel_text: tool({
      description: "获取小说章节原始文本内容",
      inputSchema: z.object({
        id: z.string().describe("章节id"),
      }),
      execute: async ({ id }) => {
        console.log("[tools] get_novel_text", id);
        const thinking = msg.thinking(`正在获取小说章节原文...`);
        const data = await u.db("o_novel").where({ id }).select("chapterData").first();
        const text = data && data?.chapterData ? data.chapterData : "";
        thinking.appendText(`获取到原文:\n` + text);
        thinking.updateTitle(`获取小说章节原文完成`);
        thinking.complete();
        return text;
      },
    }),
    //======================
    update_script_to_sqlite: tool({
      description: "更新剧本，修改数据库对应剧本，供后续业务使用",
      inputSchema: z.object({
        script: ScriptSchema,
      }),
      execute: async ({ script }) => {
        await u.db("o_script").where({ id: script.id }).update({
          name: script.name,
          content: script.content,
        });
        socket.emit("setPlanData", { key: "script", value: script.id });
        return true;
      },
    }),
    insert_script_to_sqlite: tool({
      description: "新增剧本,将剧本内容插入sqlite数据库，供后续业务使用",
      inputSchema: z.object({
        script: ScriptSchema.omit({ id: true }),
      }),
      execute: async ({ script }) => {
        const [scriptId] = await u.db("o_script").insert({
          name: script.name,
          content: script.content,
          projectId: resTool.data.projectId,
          createTime: Date.now(),
        });
        socket.emit("setPlanData", { key: "script", value: scriptId });
        return true;
      },
    }),
    delete_script_to_sqlite: tool({
      description: "删除剧本,将剧本内容从sqlite数据库中删除",
      inputSchema: z.object({
        scriptId: z.string().describe("剧本id"),
      }),
      execute: async ({ scriptId }) => {
        console.log("[tools] delete_script_to_sqlite", scriptId);
        await u.db("o_script").where({ id: scriptId }).delete();
        socket.emit("setPlanData", { key: "script", value: scriptId });
        return true;
      },
    }),
  };

  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([n]) => toolsNames.includes(n))) : tools;
};
