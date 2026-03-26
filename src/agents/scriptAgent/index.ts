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
  abortSignal?: AbortSignal;
  resTool: ResTool;
}

function buildSystemPrompt(skillPrompt: string, mem: Awaited<ReturnType<Memory["get"]>>): string {
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
  if (!memoryContext) return skillPrompt;
  return `${skillPrompt}\n\n## Memory\n以下是你对用户的记忆，可作为参考但不要主动提及：\n${memoryContext}`;
}

const subAgentList = ["executionAI", "supervisionAI"] as const;

export async function decisionAI(ctx: AgentContext) {
  const { isolationKey, text, abortSignal, resTool } = ctx;

  resTool.systemMessage("决策层AI 接管聊天");

  const memory = new Memory("scriptAgent", isolationKey);
  await memory.add("user", text);
  const [skill, mem] = await Promise.all([useSkill("script_agent_decision.md"), memory.get(text)]);

  const systemPrompt = buildSystemPrompt(skill.prompt, mem);

  const projectData = await u.db("o_project").where("id", resTool.data.projectId).first();
  const novelData = await u.db("o_novel").select("id", "chapterIndex as index");

  const projectInfo = [
    "## 项目信息",
    `小说名称：${projectData?.name ?? "未知"}`,
    `小说类型：${projectData?.type ?? "未知"}`,
    `小说简介：${projectData?.intro ?? "无"}`,
    `目标改编影视画风：${projectData?.artStyle ?? "无"}`,
    `目标改编视频画幅：${projectData?.videoRatio ?? "16:9"}`,
  ].join("\n");

  const prefixSystem = `${projectInfo}\n\n## 章节ID映射表\n${novelData.map((i: any) => `- ${i.id}: 第${i.index}章`).join("\n")}\n\n`;

  const { textStream } = await u.Ai.Text("scriptAgent").stream({
    system: prefixSystem + systemPrompt,
    messages: [{ role: "user", content: text }],
    abortSignal,
    tools: {
      ...skill.tools,
      ...memory.getTools(),
      run_sub_agent: runSubAgent(ctx),
      ...useTools(ctx.resTool),
    },
    onFinish: async (completion) => {
      await memory.add("assistant:decision", completion.text);
    },
  });

  return textStream;
}

//====================== 执行层 ======================

export async function executionAI(ctx: AgentContext) {
  const { isolationKey, text, abortSignal, resTool } = ctx;

  resTool.systemMessage("执行层AI 接管聊天");

  const memory = new Memory("scriptAgent", isolationKey);
  const [skill, mem] = await Promise.all([useSkill("script_agent_execution.md"), memory.get(text)]);

  const systemPrompt = buildSystemPrompt(skill.prompt, mem);

  const { textStream } = await u.Ai.Text("scriptAgent").stream({
    system: systemPrompt,
    messages: [{ role: "user", content: text }],
    abortSignal,
    tools: {
      ...skill.tools,
      ...memory.getTools(),
      ...useTools(ctx.resTool),
    },
    onFinish: async (completion) => {
      await memory.add("assistant:execution", completion.text);
    },
  });

  return textStream;
}

export async function supervisionAI(ctx: AgentContext) {
  const { isolationKey, text, abortSignal, resTool } = ctx;

  resTool.systemMessage("监督层AI 接管聊天");

  const memory = new Memory("scriptAgent", isolationKey);
  const [skill, mem] = await Promise.all([useSkill("script_agent_supervision.md"), memory.get(text)]);

  const systemPrompt = buildSystemPrompt(skill.prompt, mem);

  const { textStream } = await u.Ai.Text("scriptAgent").stream({
    system: systemPrompt,
    messages: [{ role: "user", content: text }],
    abortSignal,
    tools: {
      ...skill.tools,
      ...memory.getTools(),
    },
    onFinish: async (completion) => {
      await memory.add("assistant:supervision", completion.text);
    },
  });

  return textStream;
}

//工具函数
function runSubAgent(parentCtx: AgentContext) {
  return tool({
    description: "启动子Agent执行独立任务。可用子Agent:executionAI, decisionAI, supervisionAI",
    inputSchema: z.object({
      agent: z.enum(["executionAI", "supervisionAI"]).describe("子Agent名称"),
      prompt: z.string().max(100).describe("交给子Agent的任务简约描述"),
    }),
    execute: async ({ agent, prompt }) => {
      const fn = [executionAI, supervisionAI][subAgentList.indexOf(agent)];
      //运行子Agent
      const subTextStream = await fn({ ...parentCtx, text: prompt });

      let msg = parentCtx.resTool.textMessage();
      let fullResponse = "";

      for await (const chunk of subTextStream) {
        msg.send(chunk);
        fullResponse += chunk;
      }
      msg!.end();

      return fullResponse;
    },
  });
}
