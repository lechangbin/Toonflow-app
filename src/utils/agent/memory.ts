import u from "@/utils";
import { v4 as uuidv4 } from "uuid";
import { getEmbedding, cosineSimilarity } from "./embedding";
import type { memories as MemoryRow } from "@/types/database";
import { tool } from "ai";
import { z } from "zod";

// ── 可调配置 ──
const messagesPerSummary = 3; // 每累积多少条message触发一次summary生成
const summaryMaxLength = 500; // summary最大字符长度
const shortTermLimit = 5; // get()返回的近期未总结message条数
const summaryLimit = 10; // get()返回的summary条数
const ragLimit = 3; // get()向量相似搜索返回的message条数
const deepRetrieveSummaryLimit = 5; // deepRetrieve()向量召回summary的条数

// ── 向量搜索辅助 ──
function vectorSearch(rows: MemoryRow[], queryEmbedding: number[], limit: number) {
  return rows
    .map((row) => {
      const emb: number[] = JSON.parse(row.embedding ?? "[]");
      return { ...row, similarity: cosineSimilarity(queryEmbedding, emb) };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

class Memory {
  private agentType: string;
  private isolationKey: string;

  constructor(agentType: string, isolationKey: string) {
    this.agentType = agentType;
    this.isolationKey = isolationKey;
  }

  private async generateSummary(contents: string[]): Promise<string> {
    const { text } = await u.Ai.Text(this.agentType as any).invoke({
      system: `你是一个记忆压缩助手。请将以下多条记忆内容压缩为一段简洁的摘要，不超过${summaryMaxLength}个字符。只输出摘要内容，不要加任何前缀或解释。`,
      messages: [{ role: "user", content: contents.map((c, i) => `${i + 1}. ${c}`).join("\n") }],
    });
    return text.slice(0, summaryMaxLength);
  }

  private async judgeSummaryRelevance(keyword: string, summaries: { id: string; content: string }[]): Promise<string[]> {
    const list = summaries.map((s) => `[${s.id}] ${s.content}`).join("\n");
    const { text } = await u.Ai.Text(this.agentType as any).invoke({
      system:
        '你是一个信息检索助手。用户会给你一个关键词和一组摘要，请判断哪些摘要可能包含与关键词相关的详细信息。只返回相关摘要的id列表，用JSON数组格式，例如 ["id1","id2"]。不要解释。',
      messages: [{ role: "user", content: `关键词: ${keyword}\n\n摘要列表:\n${list}` }],
    });
    try {
      const ids = JSON.parse(text);
      if (Array.isArray(ids)) return ids.map(String);
    } catch {}
    return [];
  }

  async add( role: string = "user",content: string) {
    const id = uuidv4();
    const embedding = await getEmbedding(content);
    const now = Date.now();
    const isolationKey = this.isolationKey;

    await u.db("memories").insert({
      id,
      isolationKey,
      type: "message",
      role,
      content,
      embedding: JSON.stringify(embedding),
      relatedMessageIds: null,
      summarized: 0,
      createdAt: now,
    } as any);

    // 检查未总结消息数量
    const unsummarized = await u.db("memories").where({ isolationKey, type: "message", summarized: 0 }).orderBy("createdAt", "asc");

    if (unsummarized.length >= messagesPerSummary) {
      const batch = unsummarized.slice(0, messagesPerSummary);
      const batchIds = batch.map((m) => m.id);
      const batchContents = batch.map((m) => m.content);

      const summaryContent = await this.generateSummary(batchContents);
      const summaryEmbedding = await getEmbedding(summaryContent);
      const summaryId = uuidv4();

      await u.db("memories").insert({
        id: summaryId,
        isolationKey,
        type: "summary",
        content: summaryContent,
        embedding: JSON.stringify(summaryEmbedding),
        relatedMessageIds: JSON.stringify(batchIds),
        summarized: 0,
        createdAt: Date.now(),
      });

      // 标记已总结
      await u.db("memories").whereIn("id", batchIds).update({ summarized: 1 });
    }
  }

  async get(text: string) {
    const isolationKey = this.isolationKey;
    // shortTerm: 最近未被总结的 messages
    const shortTerm = await u
      .db("memories")
      .where({ isolationKey, type: "message", summarized: 0 })
      .orderBy("createdAt", "desc")
      .limit(shortTermLimit);
    shortTerm.reverse(); // 最旧在前

    // summaries: 最近的 summary
    const summaries = await u.db("memories").where({ isolationKey, type: "summary" }).orderBy("createdAt", "desc").limit(summaryLimit);
    summaries.reverse();

    // rag: 向量搜索所有 messages
    const queryEmbedding = await getEmbedding(text);
    const allMessages = await u.db("memories").where({ isolationKey, type: "message" });
    const ragResults = vectorSearch(allMessages, queryEmbedding, ragLimit);

    return {
      shortTerm: shortTerm.map((m: any) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })),
      summaries: summaries.map((s) => ({
        id: s.id,
        content: s.content,
        relatedMessageIds: JSON.parse(s.relatedMessageIds || "[]"),
        createdAt: s.createdAt,
      })),
      rag: ragResults.map((r) => ({ id: r.id, content: r.content, similarity: r.similarity })),
    };
  }

  async deepRetrieve(keyword: string) {
    const isolationKey = this.isolationKey;
    // 步骤1: 向量搜索 summary
    const queryEmbedding = await getEmbedding(keyword);
    const allSummaries = await u.db("memories").where({ isolationKey, type: "summary" });
    const topSummaries = vectorSearch(allSummaries, queryEmbedding, deepRetrieveSummaryLimit);

    if (topSummaries.length === 0) return [];

    // 步骤2: AI 判断相关性
    const relevantIds = await this.judgeSummaryRelevance(
      keyword,
      topSummaries.map((s) => ({ id: s.id!, content: s.content })),
    );

    if (relevantIds.length === 0) return [];

    // 步骤3: 展开查询原始 messages
    const relevantSummaries = topSummaries.filter((s) => relevantIds.includes(s.id!));
    const messageIds = relevantSummaries.flatMap((s) => JSON.parse(s.relatedMessageIds || "[]") as string[]);

    if (messageIds.length === 0) return [];

    const messages = await u.db("memories").whereIn("id", messageIds).orderBy("createdAt", "asc");

    return messages.map((m) => ({ id: m.id, content: m.content, createdAt: m.createdAt }));
  }

  getTools() {
    return {
      deepRetrieve: tool({
        description: "深度检索记忆：当你需要回忆与某个关键词相关的详细历史信息时使用此工具",
        inputSchema: z.object({
          keyword: z.string().describe("要检索的关键词"),
        }),
        execute: async ({ keyword }) => {
          const results = await this.deepRetrieve(keyword);
          if (results.length === 0) return { found: false, message: "未找到相关记忆" };
          return { found: true, memories: results.map((r) => r.content) };
        },
      }),
    };
  }
}

export default Memory;
