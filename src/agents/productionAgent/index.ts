import { createAGUIStream } from "@/utils/agent/aguiTools";
import u from "@/utils";
import Memory from "@/utils/agent/memory";
import { useSkill } from "@/utils/agent/skillsTools";
// import tools from "@/agents/productionAgent/tools";

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

export async function decisionAI(agui: ReturnType<typeof createAGUIStream>, isolationKey: string, text: string) {
  const memory = new Memory("productionAgent", isolationKey);
  await memory.add("user", text);
  const [skill, mem] = await Promise.all([useSkill("production-agent", "decision"), memory.get(text)]);

  const systemPrompt = buildSystemPrompt(skill.prompt, mem);
  console.log("%c Line:30 🍊 systemPrompt", "background:#33a5ff", systemPrompt);

  const { textStream } = await u.Ai.Text("productionAgent").stream({
    system: systemPrompt,
    messages: [{ role: "user", content: text }],
    tools: {
      ...skill.tools,
      ...memory.getTools(),
    },
    onFinish: async (completion) => {
      await memory.add("decisionAI", completion.text);
    },
  });

  return textStream;
}

export async function executionAI(agui: ReturnType<typeof createAGUIStream>, isolationKey: string, text: string) {
  const memory = new Memory("productionAgent", isolationKey);
  await memory.add("user", text);
  const [skill, mem] = await Promise.all([useSkill("production-agent", "execution"), memory.get(text)]);

  const systemPrompt = buildSystemPrompt(skill.prompt, mem);

  const { textStream } = await u.Ai.Text("productionAgent").stream({
    system: systemPrompt,
    messages: [{ role: "user", content: text }],
    tools: {
      ...skill.tools,
      ...memory.getTools(),
    },
    onFinish: async (completion) => {
      await memory.add("executionAI", completion.text);
    },
  });

  return textStream;
}

export async function supervisionAI(agui: ReturnType<typeof createAGUIStream>, isolationKey: string, text: string) {
  agui.custom("systemMessage", "已由 监督层AI 接管对话");

  const memory = new Memory("productionAgent", isolationKey);
  await memory.add("user", text);
  const [skill, mem] = await Promise.all([useSkill("production-agent", "supervision"), memory.get(text)]);

  const systemPrompt = buildSystemPrompt(skill.prompt, mem);

  const { textStream } = await u.Ai.Text("productionAgent").stream({
    system: systemPrompt,
    messages: [{ role: "user", content: text }],
    tools: {
      ...skill.tools,
      ...memory.getTools(),
    },
    onFinish: async (completion) => {
      await memory.add("supervisionAI", completion.text);
    },
  });

  return textStream;
}
