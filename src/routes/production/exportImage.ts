import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
import compressing from "compressing";
import path from "path";
import getPath from "@/utils/getPath";

export default router.post(
  "/",
  validateFields({
    shotId: z.array(
      z.object({
        id: z.string(),
      }),
    ),
  }),
  async (req, res) => {
    const { shotId } = req.body;
    const id = shotId.map((item: { id: string }) => item.id);
    const data = await u.db("o_storyboard").whereIn("id", id);
    const result = await Promise.all(
      data.map(async (item) => {
        const url = await u.oss.getFileUrl(item.filePath!);
        return { ...item, url };
      }),
    );
    const zipStream = new compressing.zip.Stream();
    result.forEach((item, index) => {
      const ext = (item.filePath?.split(".").pop() || "png").toLowerCase();
      const absPath = path.join(getPath("oss"), item.filePath!);
      zipStream.addEntry(absPath, { relativePath: `${index}.${ext}` });
    });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=export.zip");
    zipStream.pipe(res);
  },
);
