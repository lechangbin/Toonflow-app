import express from "express";
import { z } from "zod";
import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    await getDatabaseRuntime().work((db) => db("o_videoTrack").where("id", id).delete());
    await getDatabaseRuntime().work((db) =>
      db("o_storyboard").where("trackId", id).update({
        trackId: null,
      }),
    );
    res.status(200).send(success({ message: "视频段删除成功" }));
  },
);
