import { createHash } from "node:crypto";

import { appendCausalTrace } from "@/agentRuntime/causalTrace";
import type { DatabaseWork } from "@/database";

import { VIDEO_GENERATION_APPROVAL_SCOPE } from "./videoGenerationApproval";
import { VideoRequestLedgerConflictError } from "./videoRequestLedger";

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const maxVideoBytes = 80_000_000;

export interface VideoArtifactObservation {
  requestId: string; artifactHash: string; mediaPath: string;
  status: "observed" | "late"; duplicate: boolean;
}
export type VideoArtifactInspection = VideoArtifactObservation
  | { requestId: string; artifactHash: string; mediaPath: string;
    status: "write_pending"; duplicate: false };

function conflict(): never { throw new VideoRequestLedgerConflictError(); }

function inspectMp4(base64: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)
    || base64.length > Math.ceil(maxVideoBytes * 4 / 3) + 4) conflict();
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 16 || bytes.length > maxVideoBytes
    || bytes.toString("base64") !== base64
    || bytes.toString("ascii", 4, 8) !== "ftyp") conflict();
  return bytes;
}

/** Media observation remains separate from Project Video acceptance. */
export function createVideoArtifactRuntime(dependencies: {
  work: DatabaseWork; now(): number; createId(): string;
  writeMedia(path: string, base64: string): Promise<void>;
  readMedia(path: string): Promise<Buffer>;
}) {
  async function observe(requestId: string,
    base64: string): Promise<VideoArtifactObservation> {
    if (!requestIdPattern.test(requestId)) conflict();
    const bytes = inspectMp4(base64);
    const artifactHash = createHash("sha256").update(bytes).digest("hex");
    const request = await dependencies.work((db) => db("o_agentVideoVendorRequest")
      .where({ requestId }).first());
    if (!request || !Number.isSafeInteger(request.projectId)
      || !Number.isSafeInteger(request.trackId)) conflict();
    const mediaPath = `/${request.projectId}/agent-video/${requestId}/${artifactHash}.mp4`;
    const planned = await dependencies.work((db) => db.transaction(async (tx) => {
      const current = await tx("o_agentVideoVendorRequest")
        .where({ id: request.id, requestId }).first();
      const run = current && await tx("o_agentRun").where({ id: current.runId,
        projectId: current.projectId, scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first();
      if (!current || !run || !["dispatch_recorded", "unknown", "submitted",
        "artifact_observed", "late_artifact_observed"].includes(current.status)) conflict();
      const known = await tx("o_agentVideoArtifact")
        .where({ vendorRequestId: current.id }).first();
      if (known && (known.contentHash !== artifactHash
        || known.mediaPath !== mediaPath)) conflict();
      if (known && known.status !== "write_pending") {
        return { final: { requestId, artifactHash, mediaPath,
          status: known.status === "late" ? "late" as const : "observed" as const,
          duplicate: true }, id: known.id };
      }
      if (["artifact_observed", "late_artifact_observed"].includes(current.status)) conflict();
      if (!known) await tx("o_agentVideoArtifact").insert({
        id: dependencies.createId(), vendorRequestId: current.id,
        trackId: current.trackId, mediaPath, contentHash: artifactHash,
        status: "write_pending", createdAt: dependencies.now(),
        updatedAt: dependencies.now() });
      return { final: null, id: known?.id ?? null };
    }));
    if (planned.final) return planned.final;
    await dependencies.writeMedia(mediaPath, base64);
    const persisted = await dependencies.readMedia(mediaPath);
    if (persisted.length !== bytes.length
      || createHash("sha256").update(persisted).digest("hex") !== artifactHash) conflict();
    return dependencies.work((db) => db.transaction(async (tx) => {
      const current = await tx("o_agentVideoVendorRequest")
        .where({ id: request.id, requestId }).first();
      const known = await tx("o_agentVideoArtifact")
        .where({ vendorRequestId: request.id, contentHash: artifactHash }).first();
      if (!current || !known || known.mediaPath !== mediaPath) conflict();
      if (known.status !== "write_pending") return { requestId, artifactHash,
        mediaPath, status: known.status === "late" ? "late" as const
          : "observed" as const, duplicate: true };
      if (!["dispatch_recorded", "unknown", "submitted"].includes(current.status)) conflict();
      const run = await tx("o_agentRun").where({ id: current.runId,
        projectId: current.projectId, scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first();
      const call = await tx("o_agentToolCall")
        .where({ id: current.toolCallId, runId: current.runId }).first();
      if (!run || !call || known.trackId !== current.trackId) conflict();
      const late = run.status === "cancelled" || run.cancellationRequestedAt != null;
      const now = dependencies.now();
      const status = late ? "late" as const : "observed" as const;
      const changedArtifact = await tx("o_agentVideoArtifact")
        .where({ id: known.id, status: "write_pending" })
        .update({ status, updatedAt: now });
      const changedRequest = await tx("o_agentVideoVendorRequest")
        .where({ id: current.id, version: current.version })
        .update({ status: late ? "late_artifact_observed" : "artifact_observed",
          version: current.version + 1, updatedAt: now });
      const changedRun = await tx("o_agentRun")
        .where({ id: run.id, version: run.version })
        .update({ status: late ? run.status : "waiting",
          waitingReason: late ? run.waitingReason : "video-artifact-awaiting-commit",
          attentionReason: late ? "inspect-late-video-artifact" : null,
          allowedActions: JSON.stringify(["inspect"]),
          version: run.version + 1, updatedAt: now });
      if (changedArtifact !== 1 || changedRequest !== 1
        || changedRun !== 1) conflict();
      await appendCausalTrace(tx, { id: dependencies.createId(), runId: run.id,
        stepId: call.stepId, attemptId: call.attemptId,
        toolReceiptId: call.receiptId, toolCallId: call.id,
        videoVendorRequestId: current.id, videoArtifactId: known.id,
        eventType: late ? "video-artifact.late-observed"
          : "video-artifact.observed",
        runStatus: late ? run.status : "waiting", createdAt: now });
      return { requestId, artifactHash, mediaPath, status, duplicate: false };
    }));
  }

  return {
    observe,
    async inspect(projectId: number, actorUserId: number,
      requestId: string): Promise<VideoArtifactInspection | null> {
      if (!requestIdPattern.test(requestId)) conflict();
      return dependencies.work(async (db) => {
        if (!await db("o_project").where({ id: projectId,
          userId: actorUserId }).first("id")) conflict();
        const request = await db("o_agentVideoVendorRequest")
          .where({ projectId, requestId }).first();
        if (!request) return null;
        const artifact = await db("o_agentVideoArtifact")
          .where({ vendorRequestId: request.id }).first();
        if (!artifact) return null;
        return { requestId, artifactHash: artifact.contentHash,
          mediaPath: artifact.mediaPath, status: artifact.status,
          duplicate: false };
      });
    },
    /** Reads only an existing local media intent; never invokes the Provider. */
    async recoverPending(projectId: number, actorUserId: number,
      requestId: string): Promise<VideoArtifactObservation> {
      if (!requestIdPattern.test(requestId)) conflict();
      const pending = await dependencies.work(async (db) => {
        if (!await db("o_project").where({ id: projectId,
          userId: actorUserId }).first("id")) conflict();
        const request = await db("o_agentVideoVendorRequest")
          .where({ projectId, requestId }).first();
        if (!request) conflict();
        return db("o_agentVideoArtifact")
          .where({ vendorRequestId: request.id, status: "write_pending" }).first();
      });
      if (!pending || !digestPattern.test(pending.contentHash)
        || pending.mediaPath !== `/${projectId}/agent-video/${requestId}/${pending.contentHash}.mp4`) conflict();
      let bytes: Buffer;
      try { bytes = await dependencies.readMedia(pending.mediaPath); }
      catch { return conflict(); }
      if (bytes.length > maxVideoBytes
        || createHash("sha256").update(bytes).digest("hex") !== pending.contentHash) conflict();
      return observe(requestId, bytes.toString("base64"));
    },
  };
}
