import fs from "node:fs";
import path from "node:path";
import type { Knex } from "knex";

import { loadVendorRuntime } from "@/lib/vendorRuntime";
import getPath from "@/utils/getPath";
import { VideoPromptProfileRegistry } from "./promptProfile";

export const RETAINED_VENDOR_IDS = ["agnes", "deepseek", "minimax", "volcengine", "volcengineSd2"] as const;

export interface VideoRuntimeValidationResult {
  vendorIds: string[];
  videoModelCount: number;
  promptProfileCount: number;
}

function readVendorSourceFiles(vendorDir: string): string[] {
  const sourceFiles = fs
    .readdirSync(vendorDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name)
    .sort();
  const expectedFiles = RETAINED_VENDOR_IDS.map((id) => `${id}.ts`).sort();
  const missingFiles = expectedFiles.filter((fileName) => !sourceFiles.includes(fileName));
  if (missingFiles.length) throw new Error(`Vendor Registry 缺少内置配置: ${missingFiles.join(", ")}`);
  return sourceFiles;
}

export function validateVideoRuntimeData(dataRoot = getPath()): VideoRuntimeValidationResult {
  const promptProfiles = VideoPromptProfileRegistry.load(path.join(dataRoot, "promptProfiles", "video"));
  const vendorDir = path.join(dataRoot, "vendor");
  const sourceFiles = readVendorSourceFiles(vendorDir);

  let videoModelCount = 0;
  const vendorIds = sourceFiles.map((fileName) => {
    const source = fs.readFileSync(path.join(vendorDir, fileName), "utf8");
    const runtime = loadVendorRuntime(source, { promptProfiles });
    if (`${runtime.vendor.id}.ts` !== fileName) {
      throw new Error(`${fileName} 导出的 Vendor id 是 ${runtime.vendor.id}`);
    }
    videoModelCount += runtime.models.filter((model) => model.type === "video").length;
    return runtime.vendor.id;
  });

  return { vendorIds, videoModelCount, promptProfileCount: promptProfiles.list().length };
}

export async function validateConfiguredVideoRuntimeData(
  knex: Knex,
  dataRoot = getPath(),
): Promise<VideoRuntimeValidationResult> {
  const promptProfiles = VideoPromptProfileRegistry.load(path.join(dataRoot, "promptProfiles", "video"));
  const vendorDir = path.join(dataRoot, "vendor");
  const sourceFiles = readVendorSourceFiles(vendorDir);

  const rows = await knex("o_vendorConfig").select("id", "inputValues", "models");
  const configuredById = new Map(rows.map((row) => [row.id, row]));
  const missingConfiguredFiles = rows
    .filter((row) => !sourceFiles.includes(`${row.id}.ts`))
    .map((row) => `${row.id}.ts`);
  if (missingConfiguredFiles.length) {
    throw new Error(`已配置 Vendor 缺少源文件: ${missingConfiguredFiles.join(", ")}`);
  }

  let videoModelCount = 0;
  const vendorIds = sourceFiles.map((fileName) => {
    const vendorId = fileName.replace(/\.ts$/, "");
    const row = configuredById.get(vendorId);
    const sourcePath = path.join(vendorDir, fileName);
    const runtime = loadVendorRuntime(fs.readFileSync(sourcePath, "utf8"), {
      inputValues: JSON.parse(row?.inputValues ?? "{}"),
      customModels: JSON.parse(row?.models ?? "[]"),
      promptProfiles,
    });
    if (runtime.vendor.id !== vendorId) {
      throw new Error(`${fileName} 导出的 Vendor id 是 ${runtime.vendor.id}`);
    }
    videoModelCount += runtime.models.filter((model) => model.type === "video").length;
    return runtime.vendor.id;
  });

  return { vendorIds, videoModelCount, promptProfileCount: promptProfiles.list().length };
}
