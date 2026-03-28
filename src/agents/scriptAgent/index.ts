import { Socket } from "socket.io";
import { tool } from "ai";
import { z } from "zod";
import u from "@/utils";
import Memory from "@/utils/agent/memory";
import { useSkill } from "@/utils/agent/skillsTools";
import useTools from "@/agents/scriptAgent/tools";
import ResTool from "@/socket/resTool";

export interface AgentContext {
  socket: Socket;
  isolationKey: string;
  text: string;
  userMessageTime?: number;
  abortSignal?: AbortSignal;
  resTool: ResTool;
  msg: ReturnType<ResTool["newMessage"]>;
}

function buildMemPrompt(mem: Awaited<ReturnType<Memory["get"]>>): string {
  let memoryContext = "";
  if (mem.rag.length) {
    memoryContext += `[相关记忆]\n${mem.rag.map((r) => r.content).join("\n")}`;
  }
  if (mem.summaries.length) {
    if (memoryContext) memoryContext += "\n\n";
    memoryContext += `[历史摘要]\n${mem.summaries.map((s, i) => `${i + 1}. ${s.content}`).join("\n")}`;
  }
  if (mem.shortTerm.length) {
    if (memoryContext) memoryContext += "\n\n";
    memoryContext += `[近期对话]\n${mem.shortTerm.map((m) => `${m.role}: ${m.content}`).join("\n")}`;
  }
  return `## Memory\n以下是你对用户的记忆，可作为参考但不要主动提及：\n${memoryContext}`;
}

const subAgentList = ["executionAI", "supervisionAI"] as const;

export async function decisionAI(ctx: AgentContext) {
  const { isolationKey, text, userMessageTime, abortSignal, resTool } = ctx;

  const memory = new Memory("scriptAgent", isolationKey);
  await memory.add("user", text, { createTime: userMessageTime });

  const skill = await useSkill({ mainSkill: "script_agent_decision" }, buildMemPrompt(await memory.get(text)));

  const projectData = await u.db("o_project").where("id", resTool.data.projectId).first();
  const novelData = await u.db("o_novel").where("projectId", resTool.data.projectId).select("id", "chapterIndex as index");

  const get_project_info = tool({
    description: "获取项目的基本信息和章节ID映射表，返回字符串格式的项目信息",
    inputSchema: z.object({}),
    execute: async () => {
      const projectInfo = [
        "## 项目信息",
        `小说名称：${projectData?.name ?? "未知"}`,
        `小说类型：${projectData?.type ?? "未知"}`,
        `小说简介：${projectData?.intro ?? "无"}`,
        `目标改编影视视觉手册|画风：${projectData?.artStyle ?? "无"}`,
        `目标改编视频画幅：${projectData?.videoRatio ?? "16:9"}`,
      ].join("\n");

      const content = `${projectInfo}\n\n## 章节ID映射表\n${novelData.map((i: any) => `- 章节ID：${i.id}: 第${i.index}章`).join("\n")}\n\n`;
      return { content };
    },
  });

  const { textStream } = await u.Ai.Text("scriptAgent").stream({
    system: skill.prompt,
    messages: [{ role: "user", content: text }],
    abortSignal,
    tools: {
      ...skill.tools,
      ...memory.getTools(),
      run_sub_agent: runSubAgent(ctx),
      ...useTools({ resTool: ctx.resTool, msg: ctx.msg }),
      get_project_info,
    },
    onFinish: async (completion) => {
      await memory.add("assistant:decision", completion.text);
    },
  });

  return textStream;
}

//====================== 执行层 ======================

export async function executionAI(ctx: AgentContext) {
  const { text, abortSignal } = ctx;

  const skill = await useSkill({
    mainSkill: "script_agent_execution",
    workspace: ["script_agent_skills/execution"],
  });

  const subMsg = ctx.resTool.newMessage("assistant", "编剧");

  const prefixSystem = `
你可以使用如下XML格式写入工作区：
<storySkeleton>故事骨架内容</storySkeleton>
<adaptationStrategy>改编策略内容</adaptationStrategy>
`;

  const { textStream } = await u.Ai.Text("scriptAgent").stream({
    system: prefixSystem + skill.prompt,
    messages: [{ role: "user", content: text }],
    abortSignal,
    tools: {
      ...skill.tools,
      ...useTools({ resTool: ctx.resTool, msg: subMsg }),
    },
  });

  return { textStream, subMsg };
}

export async function supervisionAI(ctx: AgentContext) {
  const { text, abortSignal } = ctx;

  const skill = await useSkill({ mainSkill: "script_agent_supervision", workspace: ["script_agent_skills/supervision"] });

  const subMsg = ctx.resTool.newMessage("assistant", "编辑");

  const { textStream } = await u.Ai.Text("scriptAgent").stream({
    system: skill.prompt,
    messages: [{ role: "user", content: text }],
    abortSignal,
    tools: {
      ...skill.tools,
      ...useTools({
        resTool: ctx.resTool,
        msg: subMsg,
      }),
    },
  });

  return { textStream, subMsg };
}

//工具函数
function runSubAgent(parentCtx: AgentContext) {
  const memory = new Memory("scriptAgent", parentCtx.isolationKey);
  return tool({
    description: "启动子Agent执行独立任务。可用子Agent:executionAI, decisionAI, supervisionAI",
    inputSchema: z.object({
      agent: z.enum(["executionAI", "supervisionAI"]).describe("子Agent名称"),
      prompt: z.string().describe("交给子Agent的任务简约描述，100字以内"),
    }),
    execute: async ({ agent, prompt }) => {
      const fn = [executionAI, supervisionAI][subAgentList.indexOf(agent)];

      // 先完成主Agent当前的消息
      parentCtx.msg.complete();
      // 子Agent用新消息回复
      const { textStream: subTextStream, subMsg } = await fn({ ...parentCtx, text: prompt });
      let text = subMsg.text();
      let fullResponse = "";
      for await (const chunk of subTextStream) {
        text.append(chunk);
        fullResponse += chunk;
      }
      text.complete();
      subMsg.complete();
      if (fullResponse.trim()) {
        await memory.add(`assistant:${agent === "executionAI" ? "execution" : "supervision"}`, fullResponse, {
          name: agent === "executionAI" ? "编剧" : "编辑",
          createTime: new Date(subMsg.datetime).getTime(),
        });
      }

      // 为主Agent后续输出创建新消息
      parentCtx.msg = parentCtx.resTool.newMessage("assistant", "统筹");

      return fullResponse;
    },
  });
}
