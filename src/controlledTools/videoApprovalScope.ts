import { createHash } from "node:crypto";

import type { ControlledVideoPreparation } from "./videoGenerationPreparation";
import type { VideoQuoteSnapshot, VideoQuoteTarget } from "./videoQuotePolicy";

export interface FrozenVideoApprovalScope {
  projectId: number;
  payload: ControlledVideoPreparation["payload"];
  payloadHash: string;
  targetStateHash: string;
  commandHash: string;
  quote: VideoQuoteSnapshot;
  scopeHash: string;
  preview: ControlledVideoPreparation["preview"] & {
    estimatedMaxCostMicros: number; currency: string; quoteRevision: number;
    disclaimer: string;
  };
}

export class VideoApprovalScopeConflictError extends Error {
  constructor() { super("Video approval selection, command or estimate has changed"); }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function quoteTarget(projectId: number,
  prepared: ControlledVideoPreparation): VideoQuoteTarget {
  const item = prepared.payload.item;
  if (item.capabilityId !== "text-to-video" || item.inputs.length !== 0) {
    throw new VideoApprovalScopeConflictError();
  }
  return { projectId, vendorId: item.vendorId, modelId: item.modelId,
    capabilityId: "text-to-video", output: item.output, audio: item.audio };
}

/** Candidate only. Approval must call recheck before any durable authorization decision. */
export function createVideoApprovalScope(dependencies: {
  prepare(projectId: number, raw: unknown): Promise<ControlledVideoPreparation>;
  quote(target: VideoQuoteTarget): Promise<VideoQuoteSnapshot>;
}) {
  async function prepare(projectId: number, raw: unknown): Promise<FrozenVideoApprovalScope> {
    const prepared = await dependencies.prepare(projectId, raw);
    const target = quoteTarget(projectId, prepared);
    const quote = await dependencies.quote(target);
    if (hash(target) !== hash({ projectId: quote.projectId, vendorId: quote.vendorId,
      modelId: quote.modelId, capabilityId: quote.capabilityId,
      output: quote.output, audio: quote.audio })
      || !Number.isSafeInteger(quote.revision) || quote.revision <= 0
      || !Number.isSafeInteger(quote.estimatedMaxCostMicros)
      || quote.estimatedMaxCostMicros <= 0 || quote.estimatedMaxCostMicros > 1_000_000_000
      || !/^[A-Z]{3}$/u.test(quote.currency)) {
      throw new VideoApprovalScopeConflictError();
    }
    const binding = { projectId, payloadHash: prepared.payloadHash,
      targetStateHash: prepared.targetStateHash, commandHash: prepared.commandHash,
      quote: { target, revision: quote.revision,
        estimatedMaxCostMicros: quote.estimatedMaxCostMicros,
        currency: quote.currency } };
    return { projectId, payload: prepared.payload,
      payloadHash: prepared.payloadHash, targetStateHash: prepared.targetStateHash,
      commandHash: prepared.commandHash, quote, scopeHash: hash(binding),
      preview: { ...prepared.preview,
        estimatedMaxCostMicros: quote.estimatedMaxCostMicros,
        currency: quote.currency, quoteRevision: quote.revision,
        disclaimer: "Project Owner 配置的本地费用上限估算；非供应商报价或实际账单。" } };
  }

  return {
    prepare,
    async recheck(frozen: FrozenVideoApprovalScope): Promise<FrozenVideoApprovalScope> {
      const current = await prepare(frozen.projectId, frozen.payload);
      if (current.scopeHash !== frozen.scopeHash
        || current.payloadHash !== frozen.payloadHash
        || current.targetStateHash !== frozen.targetStateHash
        || current.commandHash !== frozen.commandHash
        || hash(current.preview) !== hash(frozen.preview)) {
        throw new VideoApprovalScopeConflictError();
      }
      return current;
    },
  };
}
