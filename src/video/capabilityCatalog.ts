import type { DatabaseWork } from "@/database";

import { parseVideoModel } from "./capability";

export interface VideoCapabilityCatalogDependencies {
  db: DatabaseWork;
  getVendor(vendorId: string): { id?: string; name?: string };
  getVendorModels(vendorId: string): Promise<unknown[]>;
}

export async function listEnabledVideoCapabilities(dependencies: VideoCapabilityCatalogDependencies) {
  const enabledVendors = await dependencies.db((db) =>
    db("o_vendorConfig").where("enable", 1).select("id").orderBy("id", "asc"),
  );
  return Promise.all(
    enabledVendors.map(async ({ id }) => {
      const vendor = dependencies.getVendor(id);
      const models = (await dependencies.getVendorModels(id))
        .filter((model: any) => model?.type === "video")
        .map((model) => {
          const parsed = parseVideoModel(model);
          return {
            name: parsed.name,
            modelId: parsed.modelName,
            capabilities: parsed.capabilities,
          };
        });
      return { id, name: vendor.name ?? id, models };
    }),
  );
}
