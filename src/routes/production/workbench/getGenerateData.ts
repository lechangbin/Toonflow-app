import { getDatabaseRuntime } from "@/database";
import u from "@/utils";
import { getDefaultConfiguredVendor } from "@/vendor";

import { createGetGenerateDataRouter } from "./getGenerateDataRouter";

export default createGetGenerateDataRouter({
  db: (operation) => getDatabaseRuntime().work(operation),
  getVendorModels: (vendorId) => getDefaultConfiguredVendor().inspectVendor(vendorId).then((inspection) => inspection.models),
  getFileUrl: (filePath) => u.oss.getFileUrl(filePath),
  getSmallImageUrl: (filePath) => u.oss.getSmallImageUrl(filePath),
});
