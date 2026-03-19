import { tool } from "ai";
import { z } from "zod";
import express from "express";
import { createAGUIStream } from "@/utils/agent/aguiTools";
import u from "@/utils";
import Memory from "@/utils/agent/memory";

const router = express.Router();

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default router.post("/", async (req, res) => {
  const { prompt: text, projectId, episodesId } = req.body;
  const isolationKey = `${projectId}:${episodesId}`;
  const memory = new Memory("productionAgent", isolationKey);

  const agui = createAGUIStream(res);
  agui.runStarted();

  // 存入用户消息
  await memory.add( "user",text);

  // 获取记忆上下文
  const mem = await memory.get(text);

  console.log("======================================================");
  // 构建记忆上下文文本（顺序：历史摘要 → 相关记忆 → 近期对话）
  const memoryContext = [
    mem.rag.length > 0 && `[相关记忆]\n${mem.rag.map((r) => r.content).join("\n")}`,
    mem.summaries.length > 0 && `[历史摘要]\n${mem.summaries.map((s, i) => `${i + 1}. ${s.content}`).join("\n")}`,
    mem.shortTerm.length > 0 && `[近期对话]\n${mem.shortTerm.map((m) => `${m.role}: ${m.content}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  console.log("%c Line:27 🍏 memoryContext", "background:#3f7cff", memoryContext);

  const systemPrompt = `You are a helpful assistant.${memoryContext ? `\n\n以下是你对用户的记忆，可作为参考：\n${memoryContext}` : ""}`;

  const messages = [
    {
      role: "user" as const,
      content: text,
    },
  ];

  const { textStream } = await u.Ai.Text("productionAgent").stream({
    system: systemPrompt,
    messages,
    tools: {
      deepRetrieve: tool({
        description: "深度检索记忆：当你需要回忆与某个关键词相关的详细历史信息时使用此工具",
        inputSchema: z.object({
          keyword: z.string().describe("要检索的关键词"),
        }),
        execute: async ({ keyword }) => {
          const results = await memory.deepRetrieve(keyword);
          if (results.length === 0) return { found: false, message: "未找到相关记忆" };
          return { found: true, memories: results.map((r) => r.content) };
        },
      }),
    },
    onFinish: async (completion) => {
      // 存入助手回复
      await memory.add( "assistant",completion.text);
    },
  });

  let msg: ReturnType<typeof agui.textMessage> | null = null;
  let fullResponse = "";

  for await (const chunk of textStream) {
    if (!msg) msg = agui.textMessage();
    msg.content(chunk);
    fullResponse += chunk;
    await delay(1);
  }

  msg?.end();

  agui.runFinished();
  agui.end();
});
