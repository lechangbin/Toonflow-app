import { v4 as uuid } from "uuid";

import { createAgentRuntime, type AgentRuntime } from "@/agentRuntime";
import { getDatabaseRuntime } from "@/database";
import { resolveReadOnlyScriptSkillGrants } from "@/skillRuntime/grants";
import { getDefaultConfiguredVendor } from "@/vendor";

import { prepareScriptSkillRun } from "./harnessPreparation";

let defaultRuntime: AgentRuntime | undefined;

/** Opt-in, versioned Script Harness runtime; legacy Socket/default Run paths remain separate. */
export function getDefaultScriptHarnessRuntime(): AgentRuntime {
  if (!defaultRuntime) {
    defaultRuntime = createAgentRuntime({
      work: (operation) => getDatabaseRuntime().work(operation),
      openTextCall: (target) => getDefaultConfiguredVendor().openTextCall(target),
      schedule: (work) => {
        setImmediate(() => void work().catch(() =>
          console.error("[scriptHarness] scheduled execution failed")));
      },
      now: () => Date.now(), createId: () => uuid(),
      prepareRun: (tx, input) => prepareScriptSkillRun(tx, input, uuid),
      skillMode: { grants: resolveReadOnlyScriptSkillGrants },
    });
  }
  return defaultRuntime;
}
