import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    data: z.array(
      z.object({
        prompt: z.string(),
        duration: z.number(),
        group: z.number(),
        state: z.string(),
        src: z.string().nullable(),
        associateAssetsIds: z.array(z.number()),
      }),
    ),
    scriptId: z.number(),
  }),
  async (req, res) => {
    const { data, scriptId } = req.body;
    if (!data.length) return res.status(400).send({ success: false, message: "数据不能为空" });
    for (const item of data) {
      const [id] = await u.db("o_storyboard").insert({
        prompt: item.prompt,
        duration: String(item.duration),
        group: String(item.group),
        state: item.state,
        scriptId,
        createTime: Date.now(),
      });
      if (item.associateAssetsIds?.length) {
        await u.db("o_assets2Storyboard").insert(
          item.associateAssetsIds.map((assetId: number) => ({
            assetId,
            storyboardId: id,
          })),
        );
      }
    }
    const lastStoryboard = await u.db("o_storyboard").where("scriptId", scriptId);
    return res.status(200).send(success(lastStoryboard));
  },
);
