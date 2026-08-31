import express from "express";
import { z } from "zod";

import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { getDefaultConfiguredVendor } from "@/vendor";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.string(),
    modelName: z.string(),
  }),
  async (req, res) => {
    try {
      const { id, modelName } = req.body;
      await getDefaultConfiguredVendor().configure({ kind: "custom-model-remove", vendorId: id, modelName });
      res.status(200).send(success("更新成功"));
    } catch (cause) {
      res.status(400).send(error(u.error(cause).message));
    }
  },
);
