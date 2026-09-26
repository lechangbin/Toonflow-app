import { createHash } from "node:crypto";

import { prepareVideoGenerationCommand,
  type VideoProductionDependencies } from "@/video/production";

import { freezeVideoGenerationProposal, VideoGenerationProposalContractError,
  type VideoGenerationProposalInput } from "./videoGenerationProposalContract";

export interface ControlledVideoPreparation {
  payload: VideoGenerationProposalInput;
  payloadHash: string;
  targetStateHash: string;
  commandHash: string;
  preview: { scriptId: number; trackId: number; promptRevisionId: number;
    vendorId: string; modelId: string; capabilityId: "text-to-video";
    duration: number; payloadHash: string };
}

/** No-effect preparation; approval and Vendor submission must recompute and compare all hashes. */
export async function prepareControlledVideoProposal(
  dependencies: Pick<VideoProductionDependencies, "db" | "profiles" | "vendor" | "readImage">,
  projectId: number, raw: unknown,
): Promise<ControlledVideoPreparation> {
  const before = await dependencies.db((db) =>
    freezeVideoGenerationProposal(db, projectId, raw));
  const prepared = await prepareVideoGenerationCommand(dependencies, {
    projectId, scriptId: before.payload.scriptId, item: before.payload.item,
  });
  const after = await dependencies.db((db) =>
    freezeVideoGenerationProposal(db, projectId, before.payload));
  if (after.payloadHash !== before.payloadHash
    || after.targetStateHash !== before.targetStateHash) {
    throw new VideoGenerationProposalContractError("version");
  }
  const commandHash = createHash("sha256")
    .update(JSON.stringify(prepared.commandSnapshot)).digest("hex");
  return { payload: before.payload, payloadHash: before.payloadHash,
    targetStateHash: before.targetStateHash, commandHash,
    preview: before.preview };
}
