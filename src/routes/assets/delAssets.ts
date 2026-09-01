import express from "express";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { removeAssetReferenceRows } from "@/assets/assetReferences";
import { deleteMediaFileBestEffort, deleteMediaFileIfPresent } from "@/assets/assetReferenceMedia";
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
      assetsData.map((i) => (i.filePath ? deleteMediaFileIfPresent(i.filePath) : Promise.resolve())),
    );
    const childIds = await getDatabaseRuntime().work(async (db) =>
      (await db("o_assets").where("assetsId", id).select("id")).map((row) => row.id),
    );
    const imageIds = assetsData.map((i) => i.id).filter(Boolean);
    // 单一事务：参考图行、图片行与资产行要么一起删除，要么都不删除
    const referenceMediaPaths = await getDatabaseRuntime().work(async (db) =>
      db.transaction(async (tx) => {
        const paths = await removeAssetReferenceRows(tx, [id, ...childIds]);
        if (imageIds.length > 0) {
          await tx("o_assets").whereIn("imageId", imageIds).update({ imageId: null });
        }
        await tx("o_image").where({ assetsId: id }).delete();
        await tx("o_assets").where({ id }).delete();
        await tx("o_assets").where("assetsId", id).delete();
        return paths;
      }),
    );
    // 记录已删除：参考图媒体清理尽力而为，失败只留下孤儿文件
    await Promise.all(referenceMediaPaths.map((mediaPath) => deleteMediaFileBestEffort(mediaPath)));
    res.status(200).send(success({ message: "删除资产成功" }));
  },
);
