import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getDatabaseRuntime } from "@/database";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    type: z.enum(["text", "image", "video", "all"]),
  }),
  async (req, res) => {
    const { type } = req.body;
    const dataList = await getDatabaseRuntime().work((db) => db("o_vendorConfig").select("id").where("enable", 1));
    if (!dataList.length) return res.status(200).send(success([]));
    const modelList = await Promise.all(dataList.map((i) => u.vendor.getModelList(i.id!)));
    const result = await Promise.all(
      dataList.map(async (data, index) => {
        const vendorData = await u.vendor.getVendor(data.id!);
        const models = modelList[index];
        const filtered =
          type === "all"
            ? models.filter((item: { type: string }) => item.type !== "video")
            : models.filter((item: { type: string }) => item.type === type);
        return filtered.map((item: { name: string; modelName: string; type: string }) => ({
          id: data.id,
          label: item.name,
          value: item.modelName,
          type: item.type,
          name: vendorData.name,
        }));
      }),
    );
    res.status(200).send(success(result.flat()));
  },
);
