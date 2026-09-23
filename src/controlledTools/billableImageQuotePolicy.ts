import type { DatabaseWork } from "@/database";

import type { BillableImageQuote, BillableImageTarget } from "./billableImageApproval";
import { BillableImageLedgerConflictError } from "./billableImageLedger";

export interface BillableImageQuotePolicyDependencies {
  work: DatabaseWork;
  now(): number;
  createId(): string;
}

export type BillableImageQuoteTarget = Omit<BillableImageTarget, "assetId">;

export interface SetBillableImageQuoteInput extends BillableImageQuoteTarget, BillableImageQuote {
  actorUserId: number;
  expectedRevision: number;
}

export interface BillableImageQuoteSnapshot extends BillableImageQuoteTarget, BillableImageQuote {
  revision: number;
  updatedAt: number;
}

function conflict(): never { throw new BillableImageLedgerConflictError(); }

function validTarget(input: BillableImageQuoteTarget): boolean {
  return Number.isSafeInteger(input.projectId) && input.projectId > 0
    && [input.vendorId, input.modelId, input.resolution].every((value) =>
      typeof value === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(value));
}

export function createBillableImageQuotePolicy(dependencies: BillableImageQuotePolicyDependencies) {
  return {
    async get(target: BillableImageQuoteTarget, actorUserId: number): Promise<BillableImageQuoteSnapshot | null> {
      if (!validTarget(target) || !Number.isSafeInteger(actorUserId) || actorUserId <= 0) return conflict();
      return dependencies.work(async (db) => {
        if (!await db("o_project").where({ id: target.projectId, userId: actorUserId }).first("id")) return conflict();
        const row = await db("o_agentImageQuotePolicy").where(target).first();
        return row ? { ...target, estimatedMaxCostMicros: row.estimatedMaxCostMicros,
          currency: row.currency, revision: row.revision, updatedAt: row.updatedAt } : null;
      });
    },

    /** The proposal runtime calls this only after its own Project-owner gate. */
    async quote(target: BillableImageTarget): Promise<BillableImageQuote> {
      if (!validTarget(target)) return conflict();
      return dependencies.work(async (db) => {
        const row = await db("o_agentImageQuotePolicy").where({ projectId: target.projectId,
          vendorId: target.vendorId, modelId: target.modelId, resolution: target.resolution }).first();
        if (!row || !Number.isSafeInteger(row.estimatedMaxCostMicros) || row.estimatedMaxCostMicros <= 0
          || !/^[A-Z]{3}$/.test(row.currency)) return conflict();
        return { estimatedMaxCostMicros: row.estimatedMaxCostMicros, currency: row.currency };
      });
    },

    async set(input: SetBillableImageQuoteInput): Promise<BillableImageQuoteSnapshot> {
      if (!validTarget(input) || !Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
        || !Number.isSafeInteger(input.estimatedMaxCostMicros)
        || input.estimatedMaxCostMicros <= 0 || input.estimatedMaxCostMicros > 1_000_000_000
        || !/^[A-Z]{3}$/.test(input.currency)) return conflict();
      return dependencies.work((db) => db.transaction(async (tx) => {
        if (!await tx("o_project").where({ id: input.projectId, userId: input.actorUserId }).first("id")) return conflict();
        const target = { projectId: input.projectId, vendorId: input.vendorId,
          modelId: input.modelId, resolution: input.resolution };
        const existing = await tx("o_agentImageQuotePolicy").where(target).first();
        if (Number(existing?.revision ?? 0) !== input.expectedRevision) return conflict();
        const now = dependencies.now();
        const revision = input.expectedRevision + 1;
        if (existing) {
          const changed = await tx("o_agentImageQuotePolicy").where({ id: existing.id,
            revision: input.expectedRevision }).update({ estimatedMaxCostMicros: input.estimatedMaxCostMicros,
              currency: input.currency, revision, updatedByUserId: input.actorUserId, updatedAt: now });
          if (changed !== 1) return conflict();
        } else {
          await tx("o_agentImageQuotePolicy").insert({ id: dependencies.createId(), ...target,
            estimatedMaxCostMicros: input.estimatedMaxCostMicros, currency: input.currency,
            revision, updatedByUserId: input.actorUserId, updatedAt: now });
        }
        return { ...target, estimatedMaxCostMicros: input.estimatedMaxCostMicros,
          currency: input.currency, revision, updatedAt: now };
      }));
    },
  };
}
