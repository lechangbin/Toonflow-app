import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

// 解析章节字符串，支持逗号分隔的多段（如 "1-3,5,7-9"）
function parseChapters(str: string): number[] {
  const result: number[] = [];
  // 逗号和空格之间加以划分
  const segments = str
    .split(",")
    .map((s) => s.replace(/[^\d\-]/g, "").trim())
    .filter(Boolean);
  for (const seg of segments) {
    // 匹配区间
    if (/^\d+\-\d+$/.test(seg)) {
      const [start, end] = seg.split("-").map(Number);
      if (start <= end) {
        for (let i = start; i <= end; i++) result.push(i);
      }
    } else if (/^\d+$/.test(seg)) {
      result.push(Number(seg));
    }
    // 其它格式自动忽略
  }

  return result;
}
parseChapters("7-8章");
// 清洗小说原文，生成事件列表
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    windowSize: z.number().optional().default(5), // 每组数量，默认 5
    overlap: z.number().optional().default(1), // 交叠数量，默认 1
  }),
  async (req, res) => {
    const { projectId, windowSize, overlap } = req.body;
    //删除之前的事件
    const [allChapters, novel] = await Promise.all([
      u.db("o_novel").where("projectId", projectId),
      Promise.resolve(new u.cleanNovel(windowSize, overlap)),
    ]);
    const novelIds = allChapters.map((i) => i.id);
    await u
      .db("o_eventChapter")
      .whereIn("novelId", novelIds as number[])
      .delete();

    const eventIds = await u.db("o_eventChapter").whereIn("novelId", novelIds).select("eventId").pluck("eventId");

    await u
      .db("o_event")
      .whereIn("id", eventIds as number[])
      .delete();

    const data = await novel.start(allChapters, projectId);

    const chapterMap = new Map(allChapters.map((c) => [c.chapterIndex, c]));

    const novelEvent: { eventId: number; novelId: number }[] = [];
    const now = Date.now();

    for (const item of data) {
      const [id] = await u.db("o_event").insert({
        name: item.name,
        detail: item.detail,
        createTime: now,
      });

      parseChapters(item.chapter).forEach((chapterIndex) => {
        const chapter = chapterMap.get(chapterIndex);
        if (chapter) {
          novelEvent.push({ eventId: id, novelId: chapter.id! });
        }
      });
    }

    if (novelEvent.length > 0) {
      await u.db("o_eventChapter").insert(novelEvent);
    }

    return res.status(200).send(success(data));
  },
);
