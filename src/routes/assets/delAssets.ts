import express from "express";
import u from "@/utils";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
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
    const assetsData = await getDatabaseRuntime().work(async (db) => db("o_image").where("assetsId", id));
    await Promise.all(
      assetsData.map((i) =>
        i.filePath
          ? u.oss.deleteFile(i.filePath).catch((e) => {
              if (e?.code !== "ENOENT") throw e;
            })
          : Promise.resolve(),
      ),
    );
    const imageIds = assetsData.map((i) => i.id).filter(Boolean);
    await getDatabaseRuntime().work(async (db) => {
      if (imageIds.length > 0) {
        await db("o_assets").whereIn("imageId", imageIds).update({ imageId: null });
      }
      await db("o_image").where({ assetsId: id }).delete();
      await db("o_assets").where({ id }).delete();
      await db("o_assets").where("assetsId", id).delete();
    });
    res.status(200).send(success({ message: "删除资产成功" }));
  },
);
