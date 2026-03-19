import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

import { MemoryManager, Memory } from "@/utils/agent/memory";
import { initEmbedding } from "@/utils/agent/embedding";

// 新增剧本
export default router.get("/", async (req, res) => {
  await initEmbedding();
  const memory = new MemoryManager();
  const userMessage = "小明喜欢什么？";
  const relevantMemories = await memory.searchMemories(userMessage, 1, 3, 0.4);
  console.log("%c Line:17 🍖 relevantMemories", "background:#b03734", relevantMemories);
  res.status(200).send(success({ message: "添加剧本成功" }));
});

function buildMemoryContext(relevant: Memory[], recent: Memory[]): string {
  const parts: string[] = [];

  if (relevant.length > 0) {
    parts.push("【相关记忆】");
    relevant.forEach((m) => parts.push(`- ${m.content}`));
  }

  if (recent.length > 0) {
    const recentNotInRelevant = recent.filter((r) => !relevant.some((rel) => rel.id === r.id));
    if (recentNotInRelevant.length > 0) {
      parts.push("【近期记忆】");
      recentNotInRelevant.forEach((m) => parts.push(`- ${m.content}`));
    }
  }

  return parts.length > 0 ? parts.join("\n") : "";
}
