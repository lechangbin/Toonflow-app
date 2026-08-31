import express from "express";
import { z } from "zod";

import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { getDefaultConfiguredVendor } from "@/vendor";
import { VendorConfigNotFoundError } from "@/vendor/errors";

const router = express.Router();

export default router.post("/", async (req, res) => {
  try {
    const input = z.object({ id: z.string().min(1), tsCode: z.string().min(1) }).strict().parse(req.body);
    const vendor = getDefaultConfiguredVendor();
    const { vendorId } = await vendor.configure({ kind: "program-update", vendorId: input.id, source: input.tsCode });
    const inspection = await vendor.inspectVendor(vendorId);
    res.status(200).send(success(inspection));
  } catch (cause) {
    if (cause instanceof VendorConfigNotFoundError) {
      return res.status(404).send(error(u.error(cause).message));
    }
    res.status(400).send(error(u.error(cause).message));
  }
});
