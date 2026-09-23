import { v4 as uuid } from "uuid";

import { createDefaultAssetImageGenerationDependencies, prepareAssetImageVendorRequest } from "@/assets/assetImageGeneration";
import { getDatabaseRuntime } from "@/database";
import oss from "@/utils/oss";

import { createBillableImageApprovalRuntime, type BillableImageApprovalDependencies } from "./billableImageApproval";
import { createBillableImageArtifactRuntime } from "./billableImageArtifact";
import { createBillableImageCommitRuntime } from "./billableImageCommit";
import { createBillableImageExecution } from "./billableImageExecution";
import { createBillableImageLedger } from "./billableImageLedger";
import { createDefaultBillableImagePreflight } from "./billableImagePreflight";

/** Production composition. Quote is deliberately injected until an explicit, reviewed price policy exists. */
export function createConfiguredBillableImageRuntime(quote: BillableImageApprovalDependencies["quote"]) {
  const image = createDefaultAssetImageGenerationDependencies();
  const preflight = createDefaultBillableImagePreflight();
  const verifyPreflight = async (tx: Parameters<ReturnType<typeof createDefaultBillableImagePreflight>>[0],
    scope: Parameters<ReturnType<typeof createDefaultBillableImagePreflight>>[1]) =>
    (await preflight(tx, scope)).targetStateHash;
  const approval = createBillableImageApprovalRuntime({ work: (operation) => getDatabaseRuntime().work(operation),
    now: Date.now, createId: uuid, quote, preflight });
  const ledger = createBillableImageLedger({ work: (operation) => getDatabaseRuntime().work(operation),
    now: Date.now, createId: uuid, verifyPreflight });
  const artifact = createBillableImageArtifactRuntime({ work: (operation) => getDatabaseRuntime().work(operation),
    now: Date.now, createId: uuid, writeMedia: (path, base64) => oss.writeFile(path, base64) });
  const commit = createBillableImageCommitRuntime({ work: (operation) => getDatabaseRuntime().work(operation),
    now: Date.now, createId: uuid, verifyPreflight });
  const execute = createBillableImageExecution({
    prepare: async (scope) => {
      const prepared = await prepareAssetImageVendorRequest(image, {
        projectId: scope.projectId, assetsId: scope.assetId,
        model: `${scope.vendorId}:${scope.modelId}`, resolution: scope.resolution,
      });
      if (!prepared.ok) throw new Error(`Billable image preparation rejected: ${prepared.failure.kind}`);
      return prepared.value;
    },
    preflight: (scope) => getDatabaseRuntime().work((db) => db.transaction((tx) => verifyPreflight(tx, scope))),
    dispatch: ledger.dispatch,
    invoke: (request, dispatched) => image.generateImage(request, async (stage) => {
      if (stage === "generating") {
        const changed = await getDatabaseRuntime().work((db) => db("o_image")
          .where({ id: dispatched.imageId, assetsId: dispatched.scope.assetId, state: "等待中" })
          .update({ state: "生成中" }));
        if (changed !== 1) throw new Error("Billable image cancelled before Provider submission");
      } else if (stage === "downloading") {
        await getDatabaseRuntime().work((db) => db("o_image")
          .where({ id: dispatched.imageId, assetsId: dispatched.scope.assetId, state: "生成中" })
          .update({ state: "下载中" }));
      } else {
        await getDatabaseRuntime().work((db) => db("o_image")
          .where({ id: dispatched.imageId, assetsId: dispatched.scope.assetId, state: "下载中" })
          .update({ state: "生成中" }));
      }
    }),
    markSubmissionAmbiguous: ledger.markSubmissionAmbiguous,
    observe: artifact.observe,
    currentRunVersion: async (runId, projectId) => {
      const run = await getDatabaseRuntime().work((db) => db("o_agentRun")
        .where({ id: runId, projectId }).first("version"));
      if (!run) throw new Error("Billable image Run is missing");
      return run.version;
    },
    commit: commit.commit,
  });
  return { approval, ledger, artifact, commit, execute };
}
