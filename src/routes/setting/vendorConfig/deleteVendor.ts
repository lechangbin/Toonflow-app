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
  }),
  async (req, res) => {
    try {
      const { id } = req.body;
      await getDefaultConfiguredVendor().configure({ kind: "delete", vendorId: id });
      res.status(200).send(success("删除成功"));
    } catch (cause) {
      res.status(400).send(error(u.error(cause).message));
    }
  },
);
