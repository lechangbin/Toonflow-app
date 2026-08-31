import express from "express";
import { z } from "zod";

import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { getDefaultConfiguredVendor } from "@/vendor";
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
    try {
      const { id, model } = req.body;
      await getDefaultConfiguredVendor().configure({ kind: "custom-model-update", vendorId: id, model });
      res.status(200).send(success("更新成功"));
    } catch (cause) {
      res.status(400).send(error(u.error(cause).message));
    }
  },
);
