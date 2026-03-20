import { tool, Tool } from "ai";
import { z } from "zod";
import u from "@/utils";
import { Socket } from "socket.io";

interface FlowData {
  rawScript: string;
  script: {
    blocks: string[];
  };
}

export default (socket: Socket, toolsNames?: string[]) => {
  let flowData: FlowData = {
    rawScript: "",
    script: {
      blocks: [],
    },
  };

  const tools: Record<string, Tool> = {
    get_flowData: tool({
      description: "获取当前工作区的状态/数据",
      inputSchema: z.object({
        key: z.enum(["script"]).describe("state的key,rawScript代表原始剧本文字,script代表分块后的剧本"),
      }),
      execute: async ({ key }) => {
        flowData = await new Promise((resolve) => socket.emit("getFlowData", { key }, (res: any) => resolve(res)));
        console.log("[tool] get_flowData:", key);
        return flowData[key];
      },
    }),
    set_flowData_script: tool({
      description: "保存数据到工作区",
      inputSchema: z.object({
        value: z.array(z.string()).describe("剧本分块后的文本数组"),
      }),
      execute: async ({ value }) => {
        flowData.script.blocks = value;
        socket.emit("setFlowData", { key: "script", value: { blocks: value } });

        return true;
      },
    }),
  };

  if (!toolsNames) return tools;
  else return Object.fromEntries(Object.entries(tools).filter(([name]) => toolsNames.includes(name)));
};
