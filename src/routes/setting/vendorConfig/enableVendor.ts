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
    enable: z.number(),
  }),
  async (req, res) => {
    try {
      const { id, enable } = req.body;
      await getDefaultConfiguredVendor().configure({ kind: "enable-disable", vendorId: id, enable: enable === 1 });
      res.status(200).send(success("更新成功"));
    } catch (cause) {
      res.status(400).send(error(u.error(cause).message));
    }
  },
);
