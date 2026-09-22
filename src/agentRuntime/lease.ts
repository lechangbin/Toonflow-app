import type { Knex } from "knex";

export const DEFAULT_AGENT_RUN_LEASE_MS = 60_000;

export interface AgentRunLease {
  runId: string;
  ownerId: string;
  epoch: string;
  fence: number;
  expiresAt: number;
}

export interface ClaimAgentRunLeaseInput {
  runId: string;
  ownerId: string;
  epoch: string;
  now: number;
  durationMs: number;
}

export class AgentRunLeaseLostError extends Error {
  constructor() {
    super("Agent Run 所有权已失效");
    this.name = "AgentRunLeaseLostError";
  }
}

function validateInput(input: ClaimAgentRunLeaseInput): void {
  if (!input.runId || !input.ownerId || !input.epoch || !Number.isSafeInteger(input.now)
    || !Number.isSafeInteger(input.durationMs) || input.durationMs <= 0) {
    throw new TypeError("Agent Run 租约参数无效");
  }
}

/** Only a queued Run without attention may acquire execution ownership. */
export async function claimAgentRunLease(db: Knex, input: ClaimAgentRunLeaseInput): Promise<AgentRunLease | null> {
  validateInput(input);
  return db.transaction(async (trx) => {
    const run = await trx("o_agentRun").where({ id: input.runId, status: "queued" }).first();
    if (!run || run.attentionReason || run.cancellationRequestedAt) return null;
    const existingExpiresAt = Number(run.leaseExpiresAt ?? 0);
    if (existingExpiresAt > input.now) {
      if (run.leaseOwnerId !== input.ownerId || run.leaseEpoch !== input.epoch) return null;
      return {
        runId: input.runId, ownerId: input.ownerId, epoch: input.epoch,
        fence: Number(run.fence), expiresAt: existingExpiresAt,
      };
    }
    const fence = Number(run.fence ?? 0) + 1;
    const expiresAt = input.now + input.durationMs;
    if (!Number.isSafeInteger(expiresAt)) throw new TypeError("Agent Run 租约过期时间无效");
    const changed = await trx("o_agentRun").where({
      id: input.runId, status: "queued", version: run.version, fence: run.fence,
    }).update({
      leaseOwnerId: input.ownerId,
      leaseEpoch: input.epoch,
      leaseExpiresAt: expiresAt,
      fence,
      version: run.version + 1,
      updatedAt: input.now,
    });
    if (changed !== 1) return null;
    return { runId: input.runId, ownerId: input.ownerId, epoch: input.epoch, fence, expiresAt };
  });
}

/** Heartbeats extend the same fence without changing the lifecycle revision. */
export async function renewAgentRunLease(db: Knex, lease: AgentRunLease, now: number, durationMs: number): Promise<AgentRunLease> {
  validateInput({ runId: lease.runId, ownerId: lease.ownerId, epoch: lease.epoch, now, durationMs });
  const expiresAt = now + durationMs;
  if (!Number.isSafeInteger(expiresAt)) throw new TypeError("Agent Run 租约过期时间无效");
  const changed = await db("o_agentRun")
    .where({ id: lease.runId, leaseOwnerId: lease.ownerId, leaseEpoch: lease.epoch, fence: lease.fence })
    .whereIn("status", ["queued", "running"])
    .where("leaseExpiresAt", ">", now)
    .update({ leaseExpiresAt: expiresAt });
  if (changed !== 1) throw new AgentRunLeaseLostError();
  return { ...lease, expiresAt };
}

/** Call inside the same transaction as a worker state write. */
export async function assertAgentRunLease(trx: Knex.Transaction, lease: AgentRunLease, now: number): Promise<void> {
  const owned = await trx("o_agentRun")
    .where({ id: lease.runId, leaseOwnerId: lease.ownerId, leaseEpoch: lease.epoch, fence: lease.fence })
    .where("leaseExpiresAt", ">", now)
    .whereIn("status", ["queued", "running"])
    .first("id");
  if (!owned) throw new AgentRunLeaseLostError();
}
