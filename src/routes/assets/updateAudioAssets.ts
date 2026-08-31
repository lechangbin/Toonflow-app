import express from "express";
import u from "@/utils";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增资产
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string(),
    describe: z.string(),
    projectId: z.number(),
    assetsItem: z.array(
      z.object({
        src: z.string().optional(),
        id: z.number().optional(),
        base64: z.string().optional(),
        prompt: z.string(),
        describe: z.string(),
        name: z.string(),
      }),
    ),
  }),
  async (req, res) => {
    const { id, name, describe, projectId, assetsItem } = req.body;
    await Promise.all(
      assetsItem.map(async (i: { src?: string; id?: number; base64: string; prompt: string }) => {
        if (i.src) {
          i.src = u.replaceUrl(i.src);
        }
        if (i.base64) {
          const mimeMatch = i.base64.match(/^data:audio\/([^;]+);base64,/);
          const mimeExt = mimeMatch ? mimeMatch[1] : "mp3";
          const mimeToExt: Record<string, string> = {
            mpeg: "mp3",
            "x-wav": "wav",
            "x-aiff": "aiff",
            "x-m4a": "m4a",
            "x-flac": "flac",
          };
          const ext = mimeToExt[mimeExt] ?? mimeExt;
          const savePath = `/${projectId}/assets/audio/${u.uuid()}.${ext}`;
          const base64Data = i.base64.replace(/^data:[^;]+;base64,/, "");
          await u.oss.writeFile(savePath, base64Data);
          i.src = savePath;
        }
      }),
    );

    await getDatabaseRuntime().work(async (db) => {
      await db("o_assets").where("id", id).update({
        name,
        describe,
      });
    });

    // 删除不在 assetsItem 中的子项
    const existingItems = await getDatabaseRuntime().work(async (db) => {
      return await db("o_assets").where("assetsId", id).select("id");
    });
    const existingIds = existingItems.map((i: { id?: number }) => i.id!);
    const incomingIds = assetsItem.filter((i: { id?: number }) => i.id).map((i: { id?: number }) => i.id);
    const toDeleteIds = existingIds.filter((eid: number) => !incomingIds.includes(eid));
    if (toDeleteIds.length > 0) {
      await getDatabaseRuntime().work(async (db) => {
        const deleteItems = await db("o_assets").whereIn("id", toDeleteIds).select("imageId");
        const deleteImageIds = deleteItems.map((i: { imageId?: number | null }) => i.imageId!).filter(Boolean);
        // 先将 o_assets.imageId 置空，解除外键约束，再删除 o_image，最后删除 o_assets
        await db("o_assets").whereIn("id", toDeleteIds).update({ imageId: null });
        if (deleteImageIds.length > 0) {
          await db("o_image").whereIn("id", deleteImageIds).delete();
        }
        await db("o_assets").whereIn("id", toDeleteIds).delete();
      });
    }

    await getDatabaseRuntime().work(async (db) => {
      for (const item of assetsItem) {
        if (item.id) {
          await db("o_assets").where("id", item.id).update({
            prompt: item.prompt,
            describe: item.describe,
            name: item.name,
          });
          const itemData = await db("o_assets").where("id", item.id).select("imageId").first();
          await db("o_image").where("id", itemData?.imageId).update({
            filePath: item.src,
          });
        } else {
          const [assetsId] = await db("o_assets").insert({
            prompt: item.prompt,
            assetsId: id,
            type: "audio",
            projectId,
            describe: item.describe,
            name: item.name,
            startTime: Date.now(),
          });
          const [imageId] = await db("o_image").insert({
            filePath: item.src,
            type: "audio",
            assetsId,
            state: "已完成",
          });
          await db("o_assets").where("id", assetsId).update({
            imageId,
          });
        }
      }
    });

    res.status(200).send(success({ message: "新增资产成功" }));
  },
);
