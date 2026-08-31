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
    id: z.number(),
    name: z.string(),
    model: z.string(),
    modelName: z.string(),
    vendorId: z.string().nullable(),
    desc: z.string(),
    temperature: z.number().optional(),
    maxOutputTokens: z.number().optional(),
  }),
  async (req, res) => {
    try {
      const { id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens } = req.body;
      await getDefaultConfiguredVendor().configure({
        kind: "agent-binding",
        bindings: [{ id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens }],
      });
      res.status(200).send(success("配置成功"));
    } catch (cause) {
      res.status(400).send(error(u.error(cause).message));
    }
  },
);
