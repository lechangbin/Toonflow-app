import express from "express";

import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { getDefaultConfiguredVendor } from "@/vendor";
import { listEnabledVideoCapabilities } from "@/video/capabilityCatalog";

const router = express.Router();

export default router.post("/", async (_req, res, next) => {
  try {
    const vendor = getDefaultConfiguredVendor();
    const catalog = await listEnabledVideoCapabilities({
      db: (operation) => getDatabaseRuntime().work(operation),
      getVendor: (vendorId) => vendor.inspectVendor(vendorId),
      getVendorModels: (vendorId) => vendor.inspectVendor(vendorId).then((inspection) => inspection.models),
    });
    res.status(200).send(success(catalog));
  } catch (error) {
    next(error);
  }
});
