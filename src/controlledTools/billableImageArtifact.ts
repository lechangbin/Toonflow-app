import { createHash } from "node:crypto";

import type { Knex } from "knex";

import { detectImageMime } from "@/assets/assetReferenceMedia";
import type { DatabaseWork } from "@/database";

import { billableImageAllowedActions, transitionBillableImage, type BillableImageState } from "./billableImageLifecycle";
import { BillableImageLedgerConflictError } from "./billableImageLedger";

export interface BillableImageArtifactDependencies {
  work: DatabaseWork;
  now(): number;
  createId(): string;
  writeMedia(path: string, base64: string): Promise<void>;
}

export interface BillableImageArtifactObservation {
  requestId: string;
  artifactHash: string;
  mediaPath: string;
  status: "observed" | "late";
  duplicate: boolean;
}

function reject(): never { throw new BillableImageLedgerConflictError(); }

function stateOf(row: any): BillableImageState {
  return { status: row.status, scopeHash: row.scopeHash, requestId: row.requestId,
    providerTaskId: row.providerTaskId ?? null, artifactHash: row.artifactHash ?? null,
    cancellationRequested: row.cancellationRequestedAt != null };
}

function inspectMedia(base64: string): { content: Buffer; mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp" } {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 20_000_000) return reject();
  const content = Buffer.from(base64, "base64");
  if (content.length < 8 || content.toString("base64") !== base64) return reject();
  const mime = detectImageMime(content);
  if (!mime) return reject();
  return { content, mime };
}

/** Writes a deterministic, request-scoped media object, then commits a durable observation.
 * A local write can precede a failed DB transaction; such an object is orphaned, never linked or reported as success.
 */
export function createBillableImageArtifactRuntime(dependencies: BillableImageArtifactDependencies) {
  return {
    async observe(requestId: string, base64: string): Promise<BillableImageArtifactObservation> {
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) return reject();
      const { content, mime } = inspectMedia(base64);
      const artifactHash = createHash("sha256").update(content).digest("hex");
      const before = await dependencies.work((db) => db("o_agentVendorRequest").where({ requestId }).first());
      if (!before || !Number.isSafeInteger(before.projectId) || !Number.isSafeInteger(before.assetId)) return reject();
      const existing = await dependencies.work((db) => db("o_agentImageArtifact")
        .where({ vendorRequestId: before.id, contentHash: artifactHash }).first());
      if (existing) return { requestId, artifactHash, mediaPath: existing.mediaPath,
        status: existing.status === "late" ? "late" : "observed", duplicate: true };
      if (before.artifactHash && before.artifactHash !== artifactHash) return reject();
      let planned: BillableImageState;
      try { planned = transitionBillableImage(stateOf(before), { kind: "artifact_observed", artifactHash }); }
      catch { return reject(); }
      const extension = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg"
        : mime === "image/gif" ? "gif" : "webp";
      const mediaPath = `/${before.projectId}/agent-image/${requestId}/${artifactHash}.${extension}`;
      await dependencies.writeMedia(mediaPath, base64);
      return dependencies.work((db) => db.transaction(async (tx) => {
        const request = await tx("o_agentVendorRequest").where({ id: before.id, requestId }).first();
        const known = await tx("o_agentImageArtifact").where({ vendorRequestId: before.id,
          contentHash: artifactHash }).first();
        if (known) return { requestId, artifactHash, mediaPath: known.mediaPath,
          status: known.status === "late" ? "late" as const : "observed" as const, duplicate: true };
        if (!request || (request.artifactHash && request.artifactHash !== artifactHash)) return reject();
        let next: BillableImageState;
        try { next = transitionBillableImage(stateOf(request), { kind: "artifact_observed", artifactHash }); }
        catch { return reject(); }
        if (planned.status === "late_artifact_observed" && next.status === "artifact_observed") return reject();
        const now = dependencies.now();
        const status = next.status === "late_artifact_observed" ? "late" as const : "observed" as const;
        await tx("o_agentImageArtifact").insert({ id: dependencies.createId(), vendorRequestId: request.id,
          assetId: request.assetId, imageId: request.imageId, mediaPath, contentHash: artifactHash,
          status, createdAt: now, updatedAt: now });
        const changed = await tx("o_agentVendorRequest").where({ id: request.id, version: request.version }).update({
          status: next.status, artifactHash, version: request.version + 1, updatedAt: now,
        });
        if (changed !== 1) return reject();
        const run = await tx("o_agentRun").where({ id: request.runId, projectId: request.projectId }).first();
        if (!run) return reject();
        const stopped = run.status === "cancelled" && run.allowedActions === '["inspect"]';
        const changedRun = await tx("o_agentRun").where({ id: run.id, version: run.version }).update({
          status: stopped ? "cancelled" : "waiting",
          waitingReason: stopped ? null : status === "late" ? "late-artifact-after-cancel" : "artifact-awaiting-commit",
          attentionReason: status === "late" ? "inspect-late-artifact" : null,
          allowedActions: stopped ? JSON.stringify(["inspect"]) : JSON.stringify(billableImageAllowedActions(next)),
          version: run.version + 1, updatedAt: now,
        });
        if (changedRun !== 1) return reject();
        return { requestId, artifactHash, mediaPath, status, duplicate: false };
      }));
    },

    async inspect(projectId: number, actorUserId: number, requestId: string): Promise<BillableImageArtifactObservation | null> {
      return dependencies.work(async (db: Knex) => {
        if (!await db("o_project").where({ id: projectId, userId: actorUserId }).first("id")) return reject();
        const request = await db("o_agentVendorRequest").where({ projectId, requestId }).first();
        if (!request || !request.artifactHash) return null;
        const artifact = await db("o_agentImageArtifact").where({ vendorRequestId: request.id,
          contentHash: request.artifactHash }).first();
        if (!artifact) return reject();
        return { requestId, artifactHash: artifact.contentHash, mediaPath: artifact.mediaPath,
          status: artifact.status === "late" ? "late" : "observed", duplicate: false };
      });
    },
  };
}
