import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { loadVendorRuntime } from "@/lib/vendorRuntime";
import { vendorModelSchema } from "@/video/vendorModel";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.string(),
    modelName: z.string(),
    model: vendorModelSchema,
  }),
  async (req, res) => {
    const { id, modelName, model } = req.body;

    const models = await u.db("o_vendorConfig").where("id", id).first("models");
    if (models?.models) {
      const existingModels = JSON.parse(models.models);
      const modelIndex = existingModels.findIndex((m: any) => m.modelName === modelName);
      if (modelIndex === -1) {
        existingModels.push(model);
      } else {
        existingModels[modelIndex] = model;
      }
      loadVendorRuntime(u.vendor.getCode(id), { customModels: existingModels });
      await u
        .db("o_vendorConfig")
        .where("id", id)
        .update({
          models: JSON.stringify(existingModels),
        });
    }
    res.status(200).send(success("更新成功"));
  },
);
