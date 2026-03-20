import { tool } from "ai";
import { z } from "zod";
import u from "@/utils";
import { useSkill } from "@/utils/agent/skillsTools";
import { createAGUIStream } from "@/utils/agent/aguiTools";

interface FlowData {
  script: {
    blocks: string[];
  };
}

export default (isolationKey: string, agui: ReturnType<typeof createAGUIStream>) => {
  const flowData: FlowData = {
    script: {
      blocks: [],
    },
  };
  return {
    get_project_info: tool({
      description: "获取项目信息",
      inputSchema: z.object({}),
      execute: async () => {
        return `
      项目名称：仙逆
      视频风格：玄幻3D动漫
      视频类型：短剧
      项目描述：讲述了乡村平凡少年王林以心中之感动，逆仙而修，求的不仅是长生，更多的是摆脱那背后的蝼蚁之身。他坚信道在人为，以平庸的资质踏入修真仙途，历经坎坷风雨，凭着其聪睿的心智，一步一步走向巅峰，凭一己之力，扬名修真界。
      总集数：24集每集2分钟
      当前集数：3集
      `;
      },
    }),
    get_state: tool({
      description: "获取工作流指定板块数据",
      inputSchema: z.object({
        block: z.enum(["script"]).describe("板块名称，如 script"),
      }),
      execute: async ({ block }) => {
        return flowData[block];
      },
    }),
    execution: tool({
      description: "执行层，负责具体执行具体的任务",
      inputSchema: z.object({
        taskDescription: z.string().describe("具体的任务描述详细信息"),
      }),
      execute: async ({ taskDescription }) => {
        agui.custom("systemMessage", "已由 执行层AI 接管对话");

        const skill = await useSkill("production-agent", "execution");

        const { textStream } = await u.Ai.Text("productionAgent").stream({
          system: skill.prompt,
          messages: [{ role: "user", content: `请完成任务：${taskDescription}` }],
          tools: {
            ...skill.tools,
          },
        });

        let msg: ReturnType<typeof agui.textMessage> | null = null;
        let fullResponse = "";

        for await (const chunk of textStream) {
          if (!msg) msg = agui.textMessage();
          msg.send(chunk);
          fullResponse += chunk;
        }
        msg?.end();

        return { found: true, memories: ["第一条记忆内容", "第二条记忆内容"] };
      },
    }),
  };
};
