import { v4 as uuid } from "uuid";

import { createAgentRuntime, type AgentRuntime } from "@/agentRuntime";
import { getDatabaseRuntime } from "@/database";
import { createDefaultBillableImageRuntime } from "@/controlledTools/billableImageComposition";
import { getDefaultDerivedAssetWriteRuntime } from "@/controlledTools/derivedAssetWrite";
import { getDefaultStoryboardWriteApprovalRuntime } from "@/controlledTools/storyboardWriteApproval";
import { resolveProductionSkillGrants } from "@/skillRuntime/grants";
import { getDefaultConfiguredVendor } from "@/vendor";

import { prepareProductionSkillRun } from "./harnessPreparation";

let defaultRuntime: AgentRuntime | undefined;

/** Opt-in read-only production guidance Run; generation remains on legacy path. */
export function getDefaultProductionHarnessRuntime(): AgentRuntime {
  if (!defaultRuntime) {
    const billableImage = createDefaultBillableImageRuntime();
    const derivedAsset = getDefaultDerivedAssetWriteRuntime();
    const storyboard = getDefaultStoryboardWriteApprovalRuntime();
    defaultRuntime = createAgentRuntime({
      work: (operation) => getDatabaseRuntime().work(operation),
      openTextCall: (target) => getDefaultConfiguredVendor().openTextCall(target),
      schedule: (work) => {
        setImmediate(() => void work().catch(() =>
          console.error("[productionHarness] scheduled execution failed")));
      },
      now: () => Date.now(), createId: () => uuid(),
      prepareRun: (tx, input) => prepareProductionSkillRun(tx, input, uuid),
      skillMode: { grants: resolveProductionSkillGrants },
      productionMode: true,
      proposeBillableImage: (input) => billableImage.approval.proposeFromAgent(input),
      proposeDerivedAsset: (input) => derivedAsset.proposeFromAgent(input),
      proposeStoryboard: (input) => storyboard.proposeFromAgent(input),
    });
  }
  return defaultRuntime;
}
