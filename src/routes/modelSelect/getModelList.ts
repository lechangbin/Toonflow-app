import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    type: z.enum(["text", "image", "video", "all"]),
  }),
  async (req, res) => {
    const { type } = req.body;
    const data = await u.db("o_vendorConfig").select("id", "models", "name").first();
    if (!data) {
      return res.status(404).send({ error: "模型未找到" });
    }
    const models = JSON.parse(data.models!);
    if (type === "all") {
      const allData = models
        .filter((item: { type: string }) => item.type !== "video")
        .map((item: { name: string; modelName: string; type: string }) => ({
          id: data.id,
          label: item.name,
          value: item.modelName,
          type: item.type,
          name: data.name,
        }));
      return res.status(200).send(success(allData));
    }
    const filteredData = models
      .filter((item: { type: string }) => item.type === type)
      .map((item: { name: string; modelName: string; type: string }) => ({
        id: data.id,
        label: item.name,
        value: item.modelName,
        type: item.type,
        name: data.name,
      }));
    res.status(200).send(success(filteredData));
  },
);
