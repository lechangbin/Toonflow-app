import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    modelId: z.string(),
  }),
  async (req, res) => {
    const { modelId, type = "video" } = req.body;
    const [id, name] = modelId.split(":");
    const data = await u.db("o_vendorConfig").where("id", id).select("models").first();
    if (!data) {
      return res.status(404).send({ error: "模型未找到" });
    }
    const models = JSON.parse(data.models!);
    const findData = models.find((i) => i.modelName == name);
    res.status(200).send(success(findData));
  },
);
