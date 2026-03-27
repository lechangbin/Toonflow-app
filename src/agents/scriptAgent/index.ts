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
  const { isolationKey, text, userMessageTime, abortSignal, resTool } = ctx;

  const memory = new Memory("scriptAgent", isolationKey);
  await memory.add("user", text, { createTime: userMessageTime });
  const [skill, mem] = await Promise.all([useSkill("script_agent_decision.md"), memory.get(text)]);

  const systemPrompt = buildSystemPrompt(skill.prompt, mem);

  const projectData = await u.db("o_project").where("id", resTool.data.projectId).first();
  const novelData = await u.db("o_novel").where("projectId", resTool.data.projectId).select("id", "chapterIndex as index");

  const projectInfo = [
    "## 项目信息",
    `小说名称：${projectData?.name ?? "未知"}`,
    `小说类型：${projectData?.type ?? "未知"}`,
    `小说简介：${projectData?.intro ?? "无"}`,
    `目标改编影视视觉手册|画风：${projectData?.artStyle ?? "无"}`,
    `目标改编视频画幅：${projectData?.videoRatio ?? "16:9"}`,
  ].join("\n");

  const prefixSystem = `${projectInfo}\n\n## 章节ID映射表\n${novelData.map((i: any) => `- 章节ID：${i.id}: 第${i.index}章`).join("\n")}\n\n`;

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
  });

  return textStream;
}

//====================== 执行层 ======================

export async function executionAI(ctx: AgentContext) {
  const { isolationKey, text, abortSignal, resTool } = ctx;
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
  });

  return textStream;
}

export async function supervisionAI(ctx: AgentContext) {
  const { isolationKey, text, abortSignal, resTool } = ctx;

  const memory = new Memory("scriptAgent", isolationKey);
  const [skill, mem] = await Promise.all([useSkill("script_agent_supervision.md"), memory.get(text)]);

  const systemPrompt = buildSystemPrompt(skill.prompt, mem);

  const { textStream } = await u.Ai.Text("scriptAgent").stream({
    system: systemPrompt,
    messages: [{ role: "user", content: text }],
    abortSignal,
    tools: {
      ...skill.tools,
      ...useTools(ctx.resTool),
    },
  });

  return textStream;
}

//工具函数
function runSubAgent(parentCtx: AgentContext) {
  const memory = new Memory("scriptAgent", parentCtx.isolationKey);
  return tool({
    description: "启动子Agent执行独立任务。可用子Agent:executionAI, decisionAI, supervisionAI",
    inputSchema: z.object({
      agent: z.enum(["executionAI", "supervisionAI"]).describe("子Agent名称"),
      prompt: z.string().max(100).describe("交给子Agent的任务简约描述"),
    }),
    execute: async ({ agent, prompt }) => {
      const fn = [executionAI, supervisionAI][subAgentList.indexOf(agent)];

      const subMsg = parentCtx.resTool.newMessage("assistant", agent == "executionAI" ? "编剧" : "编辑");

      // 先完成主Agent当前的消息
      parentCtx.msg.complete();
      // 子Agent用新消息回复
      const subTextStream = await fn({ ...parentCtx, text: prompt });
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
