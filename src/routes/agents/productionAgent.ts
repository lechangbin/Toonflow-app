import express from "express";
import { createAGUIStream } from "@/utils/agent/aguiTools";
import u from "@/utils";
import Memory from "@/utils/agent/memory";
import { useSkill } from "@/utils/agent/skillsTools";
import tools from "@/agents/productionAgent/tools";

const router = express.Router();

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default router.post("/", async (req, res) => {
  const { prompt: text, projectId, episodesId } = req.body;
  const isolationKey = `${projectId}:${episodesId}`;

  //记忆
  const memory = new Memory("productionAgent", isolationKey);
  //skill
  const skill = await useSkill("production-agent", "decision");

  const agui = createAGUIStream(res);
  agui.runStarted();
  agui.custom("systemMessage", "已由 决策层AI 接管对话");

  // 存入用户消息
  await memory.add("user", text);

  // 获取记忆上下文
  const mem = await memory.get(text);
  const memoryContext = [
    mem.rag.length > 0 && `[相关记忆]\n${mem.rag.map((r) => r.content).join("\n")}`,
    mem.summaries.length > 0 && `[历史摘要]\n${mem.summaries.map((s, i) => `${i + 1}. ${s.content}`).join("\n")}`,
    mem.shortTerm.length > 0 && `[近期对话]\n${mem.shortTerm.map((m) => `${m.role}: ${m.content}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = [skill.prompt, memoryContext && `## Memory\n以下是你对用户的记忆，可作为参考但不要主动提及：\n${memoryContext}`]
    .filter(Boolean)
    .join("\n\n");

  const { textStream } = await u.Ai.Text("productionAgent").stream({
    system: systemPrompt,
    messages: [{ role: "user", content: text }],
    tools: {
      ...skill.tools,
      ...memory.getTools(),
      ...tools(isolationKey, agui),
    },
    onFinish: async (completion) => {
      // 存入助手回复
      await memory.add("decisionAI", completion.text);
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

  agui.runFinished();
  agui.end();
});
