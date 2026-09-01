import express from "express";
import u from "@/utils";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { removeAssetReferencesForAssets } from "@/assets/assetReferences";
const router = express.Router();

// 批量删除资产
export default router.post(
  "/",
  validateFields({
    id: z.array(z.number()),
  }),
  async (req, res) => {
    const { id } = req.body;
    // 同步清理这些资产的全部参考图（行 + 媒体文件）
    const referencePaths = await removeAssetReferencesForAssets(getDatabaseRuntime().work, id);
    await Promise.all(
      referencePaths.map((mediaPath) =>
        u.oss.deleteFile(mediaPath).catch((e) => {
          if (e?.code !== "ENOENT") throw e;
        }),
      ),
    );
    await getDatabaseRuntime().work(async (db) => {
      await db("o_assets").whereIn("id", id).delete();
    });
    res.status(200).send(success({ message: "删除资产成功" }));
  },
);
