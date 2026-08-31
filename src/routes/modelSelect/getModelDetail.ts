import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getDefaultConfiguredVendor } from "@/vendor";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    modelId: z.string(),
  }),
  async (req, res) => {
    const { modelId } = req.body;
    const [id, name] = modelId.split(/:(.+)/);
    const models = (await getDefaultConfiguredVendor().inspectVendor(id)).models;
    const findData = models.find((i: any) => i.modelName == name);
    res.status(200).send(success(findData));
  },
);
