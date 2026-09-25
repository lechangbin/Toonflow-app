import { v4 as uuid } from "uuid";

import { getDatabaseRuntime, type DatabaseWork } from "@/database";
import getPath from "@/utils/getPath";
import oss from "@/utils/oss";
import { getDefaultConfiguredVendor } from "@/vendor";
import { prepareVideoGenerationCommand,
  type VideoVendorPort } from "@/video/production";
import { VideoPromptProfileRegistry } from "@/video/promptProfile";

import { createVideoApprovalScope } from "./videoApprovalScope";
import { createVideoArtifactRuntime } from "./videoArtifact";
import { createVideoArtifactCommitRuntime } from "./videoArtifactCommit";
import { createVideoGenerationApprovalRuntime,
  VIDEO_GENERATION_APPROVAL_SCOPE } from "./videoGenerationApproval";
import { createVideoGenerationExecution } from "./videoGenerationExecution";
import { prepareControlledVideoProposal } from "./videoGenerationPreparation";
import { createDefaultVideoMediaResolver } from "./videoMediaResolution";
import { createVideoQuotePolicy } from "./videoQuotePolicy";
import { createVideoRequestLedger,
  VideoRequestLedgerConflictError } from "./videoRequestLedger";

/** Internal composition; callers must still provide a separate explicit Owner-facing execution gate. */
export function createVideoGenerationExecutionComposition(dependencies: {
  work: DatabaseWork; now(): number; createId(): string;
  profiles: VideoPromptProfileRegistry; vendor: VideoVendorPort;
  resolveMedia(result: string): Promise<string>;
  writeMedia(path: string, base64: string): Promise<void>;
  readMedia(path: string): Promise<Buffer>;
}) {
  const quote = createVideoQuotePolicy({ work: dependencies.work,
    now: dependencies.now, createId: dependencies.createId });
  const preparation = { db: dependencies.work, profiles: dependencies.profiles,
    vendor: dependencies.vendor,
    readImage: async () => { throw new VideoRequestLedgerConflictError(); } };
  const scope = createVideoApprovalScope({
    prepare: (projectId, raw) => prepareControlledVideoProposal(preparation, projectId, raw),
    quote: (target) => quote.quote(target),
  });
  const approval = createVideoGenerationApprovalRuntime({ work: dependencies.work,
    now: dependencies.now, createId: dependencies.createId, scope,
    quoteInTransaction: (tx, target) => quote.quote(target, tx) });
  const ledger = createVideoRequestLedger({ work: dependencies.work,
    now: dependencies.now, createId: dependencies.createId,
    recheck: scope.recheck,
    quoteInTransaction: (tx, target) => quote.quote(target, tx) });
  const artifact = createVideoArtifactRuntime({ work: dependencies.work,
    now: dependencies.now, createId: dependencies.createId,
    writeMedia: dependencies.writeMedia, readMedia: dependencies.readMedia });
  const commit = createVideoArtifactCommitRuntime({ work: dependencies.work,
    now: dependencies.now, createId: dependencies.createId });
  const execution = createVideoGenerationExecution({
    existingRequest: ledger.existingRequest,
    approvedScope: approval.approvedScope,
    prepare: async (approved) => prepareVideoGenerationCommand(preparation, {
      projectId: approved.projectId, scriptId: approved.payload.scriptId,
      item: approved.payload.item }),
    reserve: ledger.reserve,
    invoke: async (vendorId, command) => {
      const result = await dependencies.vendor.generateVideo({
        target: { vendorId, modelId: command.modelId }, input: command });
      return dependencies.resolveMedia(result);
    },
    markSubmissionAmbiguous: ledger.markSubmissionAmbiguous,
    observe: artifact.observe,
    currentRunVersion: (runId, projectId) => dependencies.work(async (db) => {
      const run = await db("o_agentRun").where({ id: runId, projectId,
        scope: VIDEO_GENERATION_APPROVAL_SCOPE }).first("version");
      if (!run) throw new VideoRequestLedgerConflictError();
      return run.version;
    }),
    commit: commit.commit,
  });
  return { quote, approval, ledger, artifact, commit, execution };
}

/** Not registered in HTTP or model Tool catalog. Empty host configuration rejects URL results. */
export function createDefaultVideoGenerationExecutionComposition() {
  const hosts = (process.env.TOONFLOW_CONTROLLED_VIDEO_MEDIA_HOSTS ?? "")
    .split(",").map((host) => host.trim()).filter(Boolean);
  const resolveMedia = createDefaultVideoMediaResolver(hosts);
  return createVideoGenerationExecutionComposition({
    work: (operation) => getDatabaseRuntime().work(operation),
    now: Date.now, createId: uuid,
    profiles: VideoPromptProfileRegistry.load(getPath(["promptProfiles", "video"])),
    vendor: getDefaultConfiguredVendor(), resolveMedia,
    writeMedia: (path, base64) => oss.writeFile(path, base64),
    readMedia: (path) => oss.getFile(path),
  });
}
