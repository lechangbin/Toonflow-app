import fs from "node:fs";
import path from "node:path";
import type { Knex } from "knex";

import { loadVendorRuntime } from "@/lib/vendorRuntime";
import { releasedVendorIds, releasedVendorSourceFileNames } from "@/lib/vendorRegistry";
import getPath from "@/utils/getPath";
import { VideoPromptProfileRegistry } from "./promptProfile";

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
  const expectedFiles = releasedVendorSourceFileNames().sort();
  const missingFiles = expectedFiles.filter((fileName) => !sourceFiles.includes(fileName));
  if (missingFiles.length) throw new Error(`Vendor Registry 缺少内置配置: ${missingFiles.join(", ")}`);
  return sourceFiles;
}

/**
 * Release build validation: the runtime data must load and must cover every
 * built-in Vendor the registry declares as released.
 */
export function validateReleaseBuildVendorData(dataRoot = getPath()): VideoRuntimeValidationResult {
  const result = validateVideoRuntimeData(dataRoot);
  const missingReleasedVendors = releasedVendorIds().filter((id) => !result.vendorIds.includes(id));
  if (missingReleasedVendors.length) {
    throw new Error(`Video Registry 缺少发布内置 Vendor: ${missingReleasedVendors.join(", ")}`);
  }
  return result;
}

/**
 * Reads the released built-in Vendor sources that make up the generated runtime
 * manifest. Line endings are normalised to LF so the generated manifest is
 * byte-stable across checkouts regardless of the host's line-ending policy.
 */
export function readReleasedVendorSources(vendorDir: string): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const fileName of releasedVendorSourceFileNames()) {
    sources[fileName] = fs.readFileSync(path.join(vendorDir, fileName), "utf8").replace(/\r\n/g, "\n");
  }
  return sources;
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
