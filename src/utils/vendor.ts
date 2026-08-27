import fs from "fs";
import path from "path";
import { loadVendorRuntime } from "@/lib/vendorRuntime";
import u from "@/utils";

export function writeCode(id: string | number, tsCode: string) {
  const runtime = loadVendorRuntime(tsCode);
  if (String(id) !== runtime.vendor.id) throw new Error(`供应商文件名 ${id} 与 Vendor id ${runtime.vendor.id} 不一致`);
  const rootDir = u.getPath("vendor")
  fs.mkdirSync(rootDir, { recursive: true })
  if (fs.existsSync(path.join(rootDir,  `${id}.ts`))) {
    fs.writeFileSync(path.join(rootDir,  `${id}.ts`), tsCode);
  }
  fs.writeFileSync(path.join(rootDir,  `${id}.ts`), tsCode);
}

export function getCode(id: string): string {
  const rootDir = u.getPath("vendor");
  const targetFile = path.join(rootDir, `${id}.ts`);
  if (!fs.existsSync(targetFile)) return "";
  return fs.readFileSync(targetFile, "utf-8");
}

export async function getModelList(id: string): Promise<Array<any>> {
  const models = await u.db("o_vendorConfig").where("id", id).select("models").first();
  if (!models || !models.models) return [];
  const code = getCode(id);
  if (!code) return [];
  return loadVendorRuntime(code, { customModels: JSON.parse(models.models) }).models;
}

export function getVendor(id: string) {
  return loadVendorRuntime(getCode(id)).vendor;
}
