import { createHash } from "node:crypto";

import type { Knex } from "knex";

import { detectImageMime } from "@/assets/assetReferenceMedia";
import {
  createDefaultAssetPromptDependencies,
  resolveAssetGenerationInputs,
  type ResolvedAssetGenerationInput,
} from "@/assets/assetPromptOrchestration";
import oss from "@/utils/oss";
import { inspectConfiguredImageModelWithDb } from "@/vendor";

import type { BillableImagePreflight } from "./billableImageApproval";
import type { BillableImageScope } from "./billableImageLifecycle";

export interface BillableImagePreflightDependencies {
  resolve(tx: Knex.Transaction, projectId: number, assetId: number): Promise<ResolvedAssetGenerationInput>;
  readMedia(path: string): Promise<Buffer>;
  isConfiguredImageModel(tx: Knex.Transaction, vendorId: string, modelId: string): Promise<boolean>;
}

export class BillableImagePreflightError extends Error {
  constructor(readonly reason: "project" | "asset" | "prompt" | "media" | "model") {
    super(`Billable image preflight rejected: ${reason}`);
    this.name = "BillableImagePreflightError";
  }
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The hash binds fresh prompt, selected references and parent anchor without persisting their content. */
export function createBillableImagePreflight(dependencies: BillableImagePreflightDependencies) {
  return async (tx: Knex.Transaction, scope: BillableImageScope): Promise<BillableImagePreflight> => {
    const [project, asset] = await Promise.all([
      tx("o_project").where({ id: scope.projectId }).first("id"),
      tx("o_assets").where({ id: scope.assetId, projectId: scope.projectId }).first(),
    ]);
    if (!project) throw new BillableImagePreflightError("project");
    if (!asset) throw new BillableImagePreflightError("asset");
    // The single-Asset dialog selects an Image Model independently of Project defaults.
    // The approved scope binds that selection; the Vendor catalogue validates availability.
    if (!(await dependencies.isConfiguredImageModel(tx, scope.vendorId, scope.modelId))) {
      throw new BillableImagePreflightError("model");
    }
    let entry: ResolvedAssetGenerationInput;
    try { entry = await dependencies.resolve(tx, scope.projectId, scope.assetId); }
    catch { throw new BillableImagePreflightError("prompt"); }
    if (entry.assetsId !== scope.assetId || !entry.generationPrompt.trim()) throw new BillableImagePreflightError("prompt");
    const byId = new Map(entry.references.map((reference) => [reference.id, reference]));
    const references: Array<{ id: number; orderIndex: number; mediaMime: string; contentHash: string }> = [];
    for (const id of entry.selectedReferenceIds) {
      const reference = byId.get(id);
      if (!reference) throw new BillableImagePreflightError("media");
      let media: Buffer;
      try { media = await dependencies.readMedia(reference.mediaPath); }
      catch { throw new BillableImagePreflightError("media"); }
      const mime = detectImageMime(media);
      if (!mime || (reference.mediaMime && reference.mediaMime !== mime)) throw new BillableImagePreflightError("media");
      references.push({ id, orderIndex: reference.orderIndex, mediaMime: mime, contentHash: hash(media) });
    }
    let anchor: { parentAssetId: number; parentImageId: number; contentHash: string } | null = null;
    if (entry.derived) {
      let media: Buffer;
      try { media = await dependencies.readMedia(entry.derived.anchorMediaPath); }
      catch { throw new BillableImagePreflightError("media"); }
      if (!detectImageMime(media)) throw new BillableImagePreflightError("media");
      anchor = { parentAssetId: entry.derived.parentAssetId, parentImageId: entry.derived.parentImageId,
        contentHash: hash(media) };
    }
    const targetStateHash = hash(JSON.stringify({
      project: { id: project.id },
      asset: { id: asset.id, projectId: asset.projectId, scriptId: asset.scriptId,
        parentAssetId: asset.assetsId, type: asset.type, name: asset.name, describe: asset.describe,
        imageId: asset.imageId },
      promptHash: hash(entry.generationPrompt), promptRevision: entry.promptRevision,
      references, anchor,
    }));
    return { targetStateHash, preview: { assetId: scope.assetId, assetName: entry.name,
      vendorId: scope.vendorId, modelId: scope.modelId, resolution: scope.resolution,
      estimatedMaxCostMicros: scope.estimatedMaxCostMicros, currency: scope.currency,
      disclaimer: "预估费用只界定本次审批范围，不保证供应商最终账单；最多提交一次。" } };
  };
}

export function createDefaultBillableImagePreflight() {
  const promptDependencies = createDefaultAssetPromptDependencies();
  return createBillableImagePreflight({
    resolve: async (tx, projectId, assetId) => {
      const result = await resolveAssetGenerationInputs({ ...promptDependencies,
        work: async (operation) => operation(tx) }, { projectId, assetsIds: [assetId] });
      if (!result.ok || result.value.length !== 1) throw new BillableImagePreflightError("prompt");
      return result.value[0];
    },
    readMedia: (path) => oss.getFile(path),
    isConfiguredImageModel: async (tx, vendorId, modelId) => {
      try {
        return await inspectConfiguredImageModelWithDb(tx, vendorId, modelId);
      } catch { return false; }
    },
  });
}
