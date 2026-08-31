import fs from "node:fs";
import path from "node:path";
import type { Knex } from "knex";

import { validateVendorRequiredInputs } from "@/lib/vendorRuntime";
import getPath from "@/utils/getPath";
import { VideoPromptProfileRegistry } from "@/video/promptProfile";

import type { ConfiguredVendorValidationResult } from "./contract";
import {
  loadConfiguredVendor,
  parseVendorModelName,
  type ConfiguredVendorDependencies,
  type LoadedConfiguredVendor,
} from "./loader";

/**
 * Startup validation for the whole configured-Vendor surface. It runs before
 * traffic, alongside the Video production domain's own `validateConfiguredVideoRuntimeData`.
 */
export async function validateConfiguredVendorsWith(
  dependencies: ConfiguredVendorDependencies,
): Promise<ConfiguredVendorValidationResult> {
  const rows = await dependencies.work((db) => db("o_vendorConfig").select("id", "enable").orderBy("id", "asc"));

  const vendorIds: string[] = [];
  let modelCount = 0;
  for (const row of rows) {
    const loaded = await loadConfiguredVendor(dependencies, row.id);
    vendorIds.push(loaded.vendorId);
    modelCount += loaded.models.length;

    // Every declared model type must be able to bind its request operation.
    assertRequestOperations(loaded);

    // A Vendor enabled for traffic must satisfy its required inputs.
    if (row.enable === 1) {
      validateVendorRequiredInputs({
        id: loaded.vendorId,
        inputValues: loaded.inputValues,
        inputs: loaded.inputs,
        models: loaded.models,
      });
    }
  }

  // Every bound Agent Text Model must resolve to a valid text Model.
  const bindings = await dependencies.work((db) =>
    db("o_agentDeploy").whereNotNull("modelName").where("modelName", "!=", "").select("key", "modelName"),
  );
  for (const binding of bindings) {
    const target = parseVendorModelName(binding.modelName);
    const loaded = await loadConfiguredVendor(dependencies, target.vendorId);
    loaded.requireText(target.modelId);
  }

  return { vendorIds, modelCount, textBindingCount: bindings.length };
}

function assertRequestOperations(loaded: LoadedConfiguredVendor): void {
  for (const type of loaded.modelTypes) {
    const model = loaded.models.find((candidate) => candidate.type === type);
    if (!model) continue;
    switch (type) {
      case "text":
        loaded.bindText(model.modelName);
        break;
      case "image":
        loaded.bindImage(model.modelName);
        break;
      case "video":
        loaded.bindVideo(model.modelName);
        break;
      case "tts":
        loaded.bindTts(model.modelName);
        break;
    }
  }
}

/** Readiness-phase entry: resolves the same loader over a live Knex handle and the data root. */
export async function validateConfiguredVendors(
  knex: Knex,
  dataRoot = getPath(),
): Promise<ConfiguredVendorValidationResult> {
  return validateConfiguredVendorsWith({
    work: async (operation) => operation(knex),
    readVendorSource: (vendorId) => readVendorSourceFile(vendorId, dataRoot),
    // Readiness validation never mutates the filesystem.
    writeVendorSource: () => undefined,
    deleteVendorSource: () => undefined,
    promptProfiles: VideoPromptProfileRegistry.load(path.join(dataRoot, "promptProfiles", "video")),
  });
}

function readVendorSourceFile(vendorId: string, dataRoot: string): string {
  const sourcePath = path.join(dataRoot, "vendor", `${vendorId}.ts`);
  if (!fs.existsSync(sourcePath)) throw new Error(`未找到供应商配置文件 ${vendorId}.ts`);
  return fs.readFileSync(sourcePath, "utf8");
}

/**
 * Filesystem side-effects for the configuration seam. The command registry owns
 * identity validation and atomic compensation; these write/delete primitives are
 * deliberately identity-agnostic so a failed candidate is never half-committed.
 */
function writeVendorSourceFile(vendorId: string, source: string, dataRoot: string): void {
  const vendorDir = path.join(dataRoot, "vendor");
  fs.mkdirSync(vendorDir, { recursive: true });
  fs.writeFileSync(path.join(vendorDir, `${vendorId}.ts`), source);
}

function deleteVendorSourceFile(vendorId: string, dataRoot: string): void {
  fs.rmSync(path.join(dataRoot, "vendor", `${vendorId}.ts`), { force: true });
}

export { readVendorSourceFile, writeVendorSourceFile, deleteVendorSourceFile };
