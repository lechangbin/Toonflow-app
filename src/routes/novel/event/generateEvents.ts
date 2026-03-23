import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

// 清洗小说原文，生成事件列表
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    novelIds: z.array(z.number()),
  }),
  async (req, res) => {
    const { projectId, novelIds } = req.body;

    const [allChapters, novel] = await Promise.all([
      u.db("o_novel").where("projectId", projectId).whereIn("id", novelIds),
      Promise.resolve(new u.cleanNovel()),
    ]);

    await u.db("o_novel").where("projectId", projectId).update({ eventState: 0, event: null });
    novel.emitter.on("item", async (item) => {
      await u
        .db("o_novel")
        .where("id", item.id)
        .update({ event: item.event, eventState: item.event ? 1 : -1 });
    });
    novel.start(allChapters, projectId);

    return res.status(200).send(success("生成事件成功"));
  },
);
