import { createHash } from "node:crypto";

import type { Knex } from "knex";
import { z } from "zod";

import type { DatabaseWork } from "@/database";
import { videoAudioSelectionSchema, videoOutputSelectionSchema } from "@/video/capability";

/** Exact local authorization estimate for one text-to-video selection. */
export const videoQuoteTargetSchema = z.strictObject({
  projectId: z.number().int().positive(),
  vendorId: z.string().trim().min(1).max(100),
  modelId: z.string().trim().min(1).max(100),
  capabilityId: z.literal("text-to-video"),
  output: videoOutputSelectionSchema,
  audio: videoAudioSelectionSchema,
});
export type VideoQuoteTarget = z.infer<typeof videoQuoteTargetSchema>;

export interface VideoQuoteSnapshot extends VideoQuoteTarget {
  estimatedMaxCostMicros: number;
  currency: string;
  revision: number;
  updatedAt: number;
}

export class VideoQuotePolicyConflictError extends Error {
  constructor() { super("Video approval estimate is missing, stale or unauthorized"); }
}

export function videoQuoteScopeKey(target: VideoQuoteTarget): string {
  const parsed = videoQuoteTargetSchema.parse(target);
  return createHash("sha256").update(JSON.stringify({
    vendorId: parsed.vendorId, modelId: parsed.modelId,
    capabilityId: parsed.capabilityId, output: parsed.output, audio: parsed.audio,
  })).digest("hex");
}

function reject(): never { throw new VideoQuotePolicyConflictError(); }

export function createVideoQuotePolicy(dependencies: {
  work: DatabaseWork; now(): number; createId(): string;
}) {
  async function read(db: Knex | Knex.Transaction,
    target: VideoQuoteTarget): Promise<VideoQuoteSnapshot | null> {
    const parsed = videoQuoteTargetSchema.parse(target);
    const scopeKey = videoQuoteScopeKey(parsed);
    const row = await db("o_agentVideoQuotePolicy")
      .where({ projectId: parsed.projectId, scopeKey }).first();
    if (!row) return null;
    if (row.scopeJson !== JSON.stringify(parsed)
      || !Number.isSafeInteger(row.estimatedMaxCostMicros)
      || row.estimatedMaxCostMicros <= 0
      || row.estimatedMaxCostMicros > 1_000_000_000
      || !/^[A-Z]{3}$/u.test(row.currency)
      || !Number.isSafeInteger(row.revision) || row.revision <= 0
      || !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0) return reject();
    return { ...parsed, estimatedMaxCostMicros: row.estimatedMaxCostMicros,
      currency: row.currency, revision: row.revision, updatedAt: row.updatedAt };
  }

  async function assertOwner(db: Knex | Knex.Transaction,
    projectId: number, actorUserId: number): Promise<void> {
    if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0
      || !await db("o_project").where({ id: projectId, userId: actorUserId }).first("id")) reject();
  }

  return {
    async get(target: VideoQuoteTarget, actorUserId: number): Promise<VideoQuoteSnapshot | null> {
      const parsed = videoQuoteTargetSchema.parse(target);
      return dependencies.work(async (db) => {
        await assertOwner(db, parsed.projectId, actorUserId);
        return read(db, parsed);
      });
    },

    /** Server-only use after the caller's Owner gate; absent estimate fails closed. */
    async quote(target: VideoQuoteTarget,
      currentDb?: Knex | Knex.Transaction): Promise<VideoQuoteSnapshot> {
      const parsed = videoQuoteTargetSchema.parse(target);
      const found = currentDb
        ? await read(currentDb, parsed)
        : await dependencies.work((db) => read(db, parsed));
      return found ?? reject();
    },

    async set(input: VideoQuoteTarget & { actorUserId: number;
      expectedRevision: number; estimatedMaxCostMicros: number;
      currency: string }): Promise<VideoQuoteSnapshot> {
      const target = videoQuoteTargetSchema.parse({ projectId: input.projectId,
        vendorId: input.vendorId, modelId: input.modelId,
        capabilityId: input.capabilityId, output: input.output, audio: input.audio });
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
        || !Number.isSafeInteger(input.estimatedMaxCostMicros)
        || input.estimatedMaxCostMicros <= 0 || input.estimatedMaxCostMicros > 1_000_000_000
        || !/^[A-Z]{3}$/u.test(input.currency)) return reject();
      return dependencies.work((db) => db.transaction(async (tx) => {
        await assertOwner(tx, target.projectId, input.actorUserId);
        const scopeKey = videoQuoteScopeKey(target);
        const existing = await tx("o_agentVideoQuotePolicy")
          .where({ projectId: target.projectId, scopeKey }).first();
        if (Number(existing?.revision ?? 0) !== input.expectedRevision
          || existing && existing.scopeJson !== JSON.stringify(target)) return reject();
        const revision = input.expectedRevision + 1;
        const updatedAt = dependencies.now();
        const values = { estimatedMaxCostMicros: input.estimatedMaxCostMicros,
          currency: input.currency, revision,
          updatedByUserId: input.actorUserId, updatedAt };
        if (existing) {
          const changed = await tx("o_agentVideoQuotePolicy")
            .where({ id: existing.id, revision: input.expectedRevision }).update(values);
          if (changed !== 1) return reject();
        } else {
          await tx("o_agentVideoQuotePolicy").insert({ id: dependencies.createId(),
            projectId: target.projectId, scopeKey,
            scopeJson: JSON.stringify(target), ...values });
        }
        return { ...target, estimatedMaxCostMicros: input.estimatedMaxCostMicros,
          currency: input.currency, revision, updatedAt };
      }));
    },
  };
}
