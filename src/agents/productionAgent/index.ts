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
      ...useTools({ resTool: ctx.resTool, msg: ctx.msg }),
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

  const skill = await useSkill("production_agent_execution.md");

  const subMsg = ctx.resTool.newMessage("assistant", "执行导演");

  const { textStream } = await u.Ai.Text("productionAgent").stream({
    system: skill.prompt,
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

  const skill = await useSkill("production_agent_supervision.md");
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
