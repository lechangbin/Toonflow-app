import { getDatabaseRuntime } from "@/database";
import u from "@/utils";

import { createGetGenerateDataRouter } from "./getGenerateDataRouter";

export default createGetGenerateDataRouter({
  db: (operation) => getDatabaseRuntime().work(operation),
  getVendorModels: (vendorId) => u.vendor.getModelList(vendorId),
  getFileUrl: (filePath) => u.oss.getFileUrl(filePath),
  getSmallImageUrl: (filePath) => u.oss.getSmallImageUrl(filePath),
});
