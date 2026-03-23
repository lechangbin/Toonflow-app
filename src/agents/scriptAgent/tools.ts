import { tool, Tool } from "ai";
import { z } from "zod";
import _ from "lodash";
import ResTool from "@/socket/resTool";

export const planData = z.object({
  event: z.string().describe("章节事件"),
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
    set_planData_event: tool({
      description: "保存章节事件到工作区",
      inputSchema: z.object({ value: planData.shape.event }),
      execute: async ({ value }) => {
        console.log("[tools] set_planData event", value);
        resTool.systemMessage("正在保存 章节事件 数据");
        socket.emit("setPlanData", { key: "event", value });
        return true;
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
    set_planData_script: tool({
      description: "保存剧本内容到工作区",
      inputSchema: z.object({ value: planData.shape.script }),
      execute: async ({ value }) => {
        console.log("[tools] set_planData script", value);
        resTool.systemMessage("正在保存 剧本 数据");
        socket.emit("setPlanData", { key: "script", value });
        return true;
      },
    }),
  };

  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([n]) => toolsNames.includes(n))) : tools;
};
