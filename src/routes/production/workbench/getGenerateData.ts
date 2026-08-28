import u from "@/utils";

import { createGetGenerateDataRouter } from "./getGenerateDataRouter";

export default createGetGenerateDataRouter({
  db: u.db,
  getVendorModels: (vendorId) => u.vendor.getModelList(vendorId),
  getFileUrl: (filePath) => u.oss.getFileUrl(filePath),
  getSmallImageUrl: (filePath) => u.oss.getSmallImageUrl(filePath),
});
