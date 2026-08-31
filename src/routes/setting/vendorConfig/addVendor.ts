import express from "express";
import { z } from "zod";

import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { getDefaultConfiguredVendor } from "@/vendor";
import { VendorConfigConflictError } from "@/vendor/errors";

const router = express.Router();

export default router.post("/", async (req, res) => {
  try {
    const { tsCode } = z.object({ tsCode: z.string().min(1) }).strict().parse(req.body);
    const vendor = getDefaultConfiguredVendor();
    const { vendorId } = await vendor.configure({ kind: "add", source: tsCode });
    const inspection = await vendor.inspectVendor(vendorId);
    res.status(200).send(success(inspection));
  } catch (cause) {
    if (cause instanceof VendorConfigConflictError) {
      return res.status(409).send(error(u.error(cause).message));
    }
    res.status(400).send(error(u.error(cause).message));
  }
});
