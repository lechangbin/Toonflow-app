import express from "express";
const router = express.Router();
import u from "@/utils";
import fs from "fs";
import Memory from "@/utils/agent/memory";


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

export default router.get("/", async (req, res) => {

  const isolationKey = "test";
  const input = "你好"

    const memory = new Memory("productionAgent", isolationKey);
  await memory.add("user", input);


  const mem = buildMemPrompt(await memory.get(input));

  res.send(mem);
});
