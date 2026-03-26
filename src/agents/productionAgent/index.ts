import { Socket } from "socket.io";
import { tool } from "ai";
import { z } from "zod";
import u from "@/utils";
import Memory from "@/utils/agent/memory";
import { useSkill } from "@/utils/agent/skillsTools";
import useTools from "@/agents/productionAgent/tools";
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
  const { isolationKey, text, abortSignal } = ctx;
  const memory = new Memory("productionAgent", isolationKey);
  await memory.add("user", text);
  const [skill, mem] = await Promise.all([useSkill("production_agent_decision.md"), memory.get(text)]);

  const systemPrompt = buildSystemPrompt(skill.prompt, mem);

  const prefixSystem = `以用户当前指令为最终目标。默认直接推进执行；仅当用户明确要求新增或修改拍摄计划时，才调用set_flowData更新scriptPlan并与用户确认。需要执行任务时调用run_sub_agent运行**executionAI**。`;

  const { textStream } = await u.Ai.Text("productionAgent").stream({
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

  const memory = new Memory("productionAgent", isolationKey);
  const [skill, mem] = await Promise.all([useSkill("production_agent_execution.md"), memory.get(text)]);

  const systemPrompt = buildSystemPrompt(skill.prompt, mem);

  const { textStream } = await u.Ai.Text("productionAgent").stream({
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
  const { isolationKey, text, abortSignal } = ctx;
  const memory = new Memory("productionAgent", isolationKey);
  const [skill, mem] = await Promise.all([useSkill("production_agent_supervision.md"), memory.get(text)]);

  const systemPrompt = buildSystemPrompt(skill.prompt, mem);

  const { textStream } = await u.Ai.Text("productionAgent").stream({
    system: systemPrompt,
    messages: [{ role: "user", content: text }],
    abortSignal,
    tools: {
      ...skill.tools,
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

      let msg: ReturnType<typeof parentCtx.resTool.textMessage>;
      let fullResponse = "";

      for await (const chunk of subTextStream) {
        if (!msg!) msg = parentCtx.resTool.textMessage();
        msg.send(chunk);
        fullResponse += chunk;
      }
      msg!.end();

      return fullResponse;
    },
  });
}
