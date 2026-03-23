import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
  }),
  async (req, res) => {
    const { projectId } = req.body;
    const storyboardData = await u.db("o_storyboard");
    const data = await Promise.all(
      storyboardData.map(async (i) => {
        return {
          ...i,
          title: i.name,
          src: i.filePath ? await u.oss.getFileUrl(i.filePath!) : "",
        };
      }),
    );
    res.status(200).send(success(data));
  },
);
