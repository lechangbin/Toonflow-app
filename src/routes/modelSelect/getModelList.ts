import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getDatabaseRuntime } from "@/database";
import { getDefaultConfiguredVendor } from "@/vendor";
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
    const vendor = getDefaultConfiguredVendor();
    const inspections = await Promise.all(dataList.map((data) => vendor.inspectVendor(data.id!)));
    const result = inspections.map((inspection) => {
      const filtered =
        type === "all"
          ? inspection.models.filter((item) => item.type !== "video")
          : inspection.models.filter((item) => item.type === type);
      return filtered.map((item) => ({
        id: inspection.vendorId,
        label: item.name,
        value: item.modelName,
        type: item.type,
        name: inspection.name,
      }));
    });
    res.status(200).send(success(result.flat()));
  },
);
