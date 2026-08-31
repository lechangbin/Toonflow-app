import express from "express";
import u from "@/utils";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增原文数据
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    data: z.array(
      z.object({
        index: z.number(),
        reel: z.string(),
        chapter: z.string(),
        chapterData: z.string(),
      }),
    ),
  }),
  async (req, res) => {
    const { projectId, data } = req.body;
    const totalNovelId: number[] = [];
    const getLastChapterIndex = await getDatabaseRuntime().work(async (db) => {
      return await db("o_novel").where("projectId", projectId).select("chapterIndex").orderBy("chapterIndex", "desc").first();
    });
    let lastChapterIndex = 0;
    if (getLastChapterIndex) {
      lastChapterIndex = getLastChapterIndex.chapterIndex!;
    }
    await getDatabaseRuntime().work(async (db) => {
      for (const item of data) {
        const [id] = await db("o_novel").insert({
          projectId,
          chapterIndex: ++lastChapterIndex,
          reel: item.reel,
          chapter: item.chapter,
          chapterData: item.chapterData,
          createTime: Date.now(),
          eventState: 0,
        });
        totalNovelId.push(id);
      }
    });
    const chapterAllList = await getDatabaseRuntime().work(async (db) => {
      return await db("o_novel").where("projectId", projectId).whereIn("id", totalNovelId);
    });
    const novelClass = new u.cleanNovel();
    novelClass.emitter.on("item", async (item) => {
      await getDatabaseRuntime().work(async (db) => {
        await db("o_novel").where("id", item.id).update({ event: item.event, eventState: item.event ? 1 : -1, errorReason: item?.errReason ?? null });
      });
    });
    novelClass.start(chapterAllList, projectId);

    res.status(200).send(success({ message: "新增原文成功" }));
  },
);
