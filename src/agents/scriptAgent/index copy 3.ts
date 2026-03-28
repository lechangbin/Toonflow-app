import { Socket } from "socket.io";
import { tool } from "ai";
import { z } from "zod";
import u from "@/utils";
import Memory from "@/utils/agent/memory";
import { useSkill } from "@/utils/agent/skillsTools";
import useTools from "@/agents/scriptAgent/tools";
import ResTool from "@/socket/resTool";
import * as fs from "fs";

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

export async function decisionAI(ctx: AgentContext) {
  const { isolationKey, text, userMessageTime, abortSignal, resTool } = ctx;

  const memory = new Memory("scriptAgent", isolationKey);
  await memory.add("user", text, { createTime: userMessageTime });

  const { skillPaths } = await useSkill({ mainSkill: "script_agent_decision" });
  const prompt = await fs.promises.readFile(skillPaths.mainSkill, "utf-8");

  const mem = buildMemPrompt(await memory.get(text));

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

  const projectPrompt = `${projectInfo}\n\n## 章节ID映射表\n${novelData.map((i: any) => `- 章节ID：${i.id}: 第${i.index}章`).join("\n")}\n\n`;

  const { textStream } = await u.Ai.Text("scriptAgent").stream({
    messages: [
      { role: "system", content: prompt },
      { role: "system", content: projectPrompt + mem },
      { role: "user", content: text },
    ],
    abortSignal,
    tools: {
      ...memory.getTools(),
      ...useTools({ resTool: ctx.resTool, msg: ctx.msg }),
      ...createSubAgent(ctx),
    },
    onFinish: async (completion) => {
      await memory.add("assistant:decision", completion.text);
    },
  });

  return textStream;
}

//====================== 执行层 ======================

function createSubAgent(parentCtx: AgentContext) {
  const { resTool, abortSignal } = parentCtx;

  const memory = new Memory("scriptAgent", parentCtx.isolationKey);

  const run_execution_agent = tool({
    description: "运行执行层subAgent执行独立任务，完成后返回结果",
    inputSchema: z.object({
      taskType: z.enum(["故事骨架", "改变策略", "剧本"]).describe("任务类型"),
      prompt: z.string().describe("交给子Agent的任务简约描述，100字以内"),
    }),
    execute: async ({ taskType, prompt }) => {
      const skill = await useSkill({ mainSkill: "script_agent_execution", workspace: ["script_agent_skills/execution"] });
      // 先完成主Agent当前的消息
      parentCtx.msg.complete();
      const subMsg = resTool.newMessage("assistant", "编剧");
      const prefixSystem =
        "你可以使用如下XML格式写入工作区：\n<storySkeleton>故事骨架内容</storySkeleton>\n<adaptationStrategy>改编策略内容</adaptationStrategy>";
      // 子Agent用新消息回复
      const { textStream } = await u.Ai.Text("scriptAgent").stream({
        system: prefixSystem + skill.prompt,
        messages: [{ role: "user", content: `请完成${taskType}任务` }],
        abortSignal,
        tools: {
          ...skill.tools,
          ...useTools({ resTool, msg: subMsg }),
          get_task_details: tool({
            description: "获取主Agent传入的任务目标详情",
            inputSchema: z.object({}),
            execute: async () => {
              const thinking = subMsg.thinking("以获取任务详情");
              thinking.appendText("任务详情:\n" + prompt);
              thinking.complete();
              return prompt ?? "无任务目标，请提示运行失败";
            },
          }),
        },
      });

      let text = subMsg.text();
      let fullResponse = "";
      for await (const chunk of textStream) {
        text.append(chunk);
        fullResponse += chunk;
      }
      text.complete();
      subMsg.complete();
      if (fullResponse.trim()) {
        await memory.add(`assistant:execution`, fullResponse, { name: "编剧", createTime: new Date(subMsg.datetime).getTime() });
      }
      // 为主Agent后续输出创建新消息
      parentCtx.msg = parentCtx.resTool.newMessage("assistant", "统筹");
      return fullResponse;
    },
  });

  const run_supervision_agent = tool({
    description: "运行监督层subAgent执行独立任务，完成后返回结果",
    inputSchema: z.object({
      prompt: z.string().describe("交给子Agent的任务简约描述，100字以内"),
    }),
    execute: async ({ prompt }) => {
      const skill = await useSkill({ mainSkill: "script_agent_supervision", workspace: ["script_agent_skills/supervision"] });

      // 先完成主Agent当前的消息
      parentCtx.msg.complete();
      // 子Agent用新消息回复

      const subMsg = resTool.newMessage("assistant", "编辑");

      const { textStream } = await u.Ai.Text("scriptAgent").stream({
        system: skill.prompt,
        messages: [{ role: "user", content: prompt }],
        abortSignal,
        tools: {
          ...skill.tools,
          ...useTools({ resTool, msg: subMsg }),
        },
      });

      let text = subMsg.text();
      let fullResponse = "";
      for await (const chunk of textStream) {
        text.append(chunk);
        fullResponse += chunk;
      }
      text.complete();
      subMsg.complete();
      if (fullResponse.trim()) {
        await memory.add(`assistant:supervision`, fullResponse, { name: "编辑", createTime: new Date(subMsg.datetime).getTime() });
      }
      // 为主Agent后续输出创建新消息
      parentCtx.msg = parentCtx.resTool.newMessage("assistant", "统筹");
      return fullResponse;
    },
  });

  return {
    run_execution_agent,
    run_supervision_agent,
  };
}
