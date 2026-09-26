import { v4 as uuid } from "uuid";

import { getDatabaseRuntime, type DatabaseWork } from "@/database";
import getPath from "@/utils/getPath";
import { getDefaultConfiguredVendor } from "@/vendor";
import { VideoPromptProfileRegistry } from "@/video/promptProfile";

import { createVideoApprovalScope } from "./videoApprovalScope";
import { createVideoGenerationApprovalRuntime } from "./videoGenerationApproval";
import { prepareControlledVideoProposal } from "./videoGenerationPreparation";
import { createVideoQuotePolicy } from "./videoQuotePolicy";

/** Owner-local approval; intentionally does not compose a Vendor dispatch adapter. */
export function createDefaultVideoGenerationApprovalRuntime() {
  const databaseWork: DatabaseWork = (operation) => getDatabaseRuntime().work(operation);
  const quote = createVideoQuotePolicy({ work: databaseWork,
    now: Date.now, createId: uuid });
  const scope = createVideoApprovalScope({
    prepare: (projectId, raw) => prepareControlledVideoProposal({
      db: databaseWork,
      profiles: VideoPromptProfileRegistry.load(getPath(["promptProfiles", "video"])),
      vendor: getDefaultConfiguredVendor(),
      readImage: async () => { throw new Error("text-to-video cannot read image input"); },
    }, projectId, raw),
    quote: (target) => quote.quote(target),
  });
  return createVideoGenerationApprovalRuntime({ work: databaseWork,
    now: Date.now, createId: uuid, scope,
    quoteInTransaction: (tx, target) => quote.quote(target, tx) });
}
