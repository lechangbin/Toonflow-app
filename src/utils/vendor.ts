import { transform } from "sucrase";
import fs from "fs";
import path from "path";
import u from "@/utils";

export function upCode(id: string, tsCode: string) {
  const rootDir = u.getPath();
  const vendor = u.vendor.getVendor(id);
  if (!vendor) throw new Error("供应商不存在");
  if (fs.existsSync(path.join(rootDir, "vendor", `${id}.ts`))) {
    fs.writeFileSync(path.join(rootDir, "vendor", `${id}.ts`), tsCode);
  }
  fs.writeFileSync(path.join(rootDir, "vendor", `${id}.ts`), tsCode);
}

export function getCode(id: string): string {
  const rootDir = u.getPath();
  const targetFile = path.join(rootDir, "vendor", `${id}.ts`);
  if (!fs.existsSync(targetFile)) return "";
  return fs.readFileSync(targetFile, "utf-8");
}

export async function getModelList(id: string): Promise<Array<any>> {
  const models = await u.db("o_vendorConfig").where("id", id).select("models").first();
  if (!models || !models.models) return [];
  const code = getCode(id);
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const vendorData = u.vm(jsCode);
  const combined = [...vendorData.vendor.models, ...JSON.parse(models?.models ?? "[]")];
  const map = new Map<string, any>();
  for (const m of combined) {
    map.set(m.modelName, m);
  }
  return [...map.values()];
}

export function getVendor(id: string) {
  const code = getCode(id);
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const vendorData = u.vm(jsCode);
  return vendorData.vendor;
}
