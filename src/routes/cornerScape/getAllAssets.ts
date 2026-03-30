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
    type: z.array(z.string()).optional(),
  }),
  async (req, res) => {
    const { projectId, type } = req.body;
    const data = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .select("o_assets.*", "o_image.filePath", "o_image.state", "o_image.model", "o_image.resolution")
      .where("o_assets.projectId", projectId)
      .andWhere("o_assets.type", "<>", "clip")
      .modify((qb) => {
        if (type && type.length > 0) qb.whereIn("o_assets.type", type);
      });
    const result = await Promise.all(
      data.map(async (parent: any) => {
        const historyImages = await u.db("o_image").where("assetsId", parent.id).andWhere("state", "已完成").select("id", "filePath");
        const historyImagesWithUrl = await Promise.all(
          historyImages.map(async (img: any) => ({
            id: img.id,
            filePath: img.filePath && (await u.oss.getFileUrl(img.filePath)),
          })),
        );
        return {
          ...parent,
          filePath: parent.filePath && (await u.oss.getFileUrl(parent.filePath!)),
          historyImages: historyImagesWithUrl,
        };
      }),
    );
    res.status(200).send(success(result));
  },
);
