import express from "express";

import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { listEnabledVideoCapabilities } from "@/video/capabilityCatalog";

const router = express.Router();

export default router.post("/", async (_req, res, next) => {
  try {
    const catalog = await listEnabledVideoCapabilities({
      db: u.db,
      getVendor: (vendorId) => u.vendor.getVendor(vendorId),
      getVendorModels: (vendorId) => u.vendor.getModelList(vendorId),
    });
    res.status(200).send(success(catalog));
  } catch (error) {
    next(error);
  }
});
