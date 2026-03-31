import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 删除剧本
export default router.post(
  "/",
  validateFields({
    id: z.array(z.number()),
  }),
  async (req, res) => {
    const { id } = req.body;
    await u.db("o_script").whereIn("id", id).delete();
    await u.db("o_assets2Script").whereIn("scriptId", id).delete();
    await u.db("o_storyboard").whereIn("scriptId", id).delete();
    await u.db("o_video").whereIn("scriptId", id).delete();
    res.status(200).send(success({ message: "删除剧本成功" }));
  },
);
