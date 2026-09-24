import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSkillToolPermission } from "../src/skillRuntime/permissions";

test("Skill Tool authority is the intersection of declared request and all independent grants", () => {
  const input = { toolName: "get_novel_text", toolRequiredCapabilities: ["read:novel"],
    skillRequestedTools: ["get_novel_text"], skillRequestedCapabilities: ["read:novel"],
    platformGrants: ["read:novel"], projectGrants: ["read:novel"],
    runGrants: ["read:novel"], roleGrants: ["read:novel"] };
  assert.equal(evaluateSkillToolPermission(input).allowed, true);
  const denied = evaluateSkillToolPermission({ ...input, projectGrants: [], runGrants: [] });
  assert.equal(denied.allowed, false);
  assert.deepEqual(denied.missing, [
    { layer: "project", capability: "read:novel" },
    { layer: "run", capability: "read:novel" },
  ]);
  assert.deepEqual(evaluateSkillToolPermission({ ...input, skillRequestedTools: [] }).missing,
    [{ layer: "skill-tool-request", capability: "get_novel_text" }]);
  assert.deepEqual(evaluateSkillToolPermission({ ...input, skillRequestedCapabilities: [] }).missing,
    [{ layer: "skill-capability-request", capability: "read:novel" }]);
});
