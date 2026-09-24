import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import knexFactory from "knex";

import initDB from "../src/lib/initDB";
import { createSkillRuntime } from "../src/skillRuntime";
import { adaptLegacySkill, previewLegacySkillImport } from "../src/skillRuntime/legacyImport";

test("pinned compatible legacy reference becomes a reviewed draft, never an active Skill", async () => {
  const db = knexFactory({ client: "better-sqlite3",
    connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try { await initDB(db); } finally { console.log = originalLog; }
    let serial = 0;
    const runtime = createSkillRuntime({ work: async (operation) => operation(db),
      now: () => 100, createId: () => `legacy-import-${++serial}` });
    const definition = await runtime.createDefinition({ name: "coming-of-age-planning",
      description: "Reviewed legacy narrative reference" });
    const proposal = await previewLegacySkillImport({
      sourceId: "coming_of_age_director_planning", skillId: definition.id,
      semanticVersion: "1.0.0" });
    assert.equal(proposal.manifest.compatibleRoles[0], "productionAgent");
    assert.deepEqual(proposal.manifest.requestedTools, []);
    assert.deepEqual(proposal.manifest.requestedCapabilities, []);
    const validated = runtime.validateDraft({ skillId: definition.id,
      semanticVersion: "1.0.0", content: proposal.content,
      manifest: proposal.manifest });
    const draft = await runtime.saveDraft({ skillId: definition.id,
      semanticVersion: "1.0.0", content: proposal.content,
      manifest: proposal.manifest });
    assert.equal(draft.contentHash, validated.contentHash);
    assert.equal((await runtime.listForAdministration())[0].binding, null,
      "import never publishes or activates a revision");
    assert.equal((await runtime.inspectRevisionForAdministration(draft.id))?.status, "draft");
  } finally { await db.destroy(); }
});

test("legacy adapter rejects changed and unknown sources", async () => {
  const raw = await readFile("data/skills/story_skills/Coming_of_age/driector_skills/director_planning_narrative.md", "utf8");
  const input = { sourceId: "coming_of_age_director_planning" as const,
    skillId: "skill-1", semanticVersion: "1.0.0" };
  assert.throws(() => adaptLegacySkill({ ...input, raw: `${raw}\nunsafe update` }),
    /source changed/);
  assert.throws(() => adaptLegacySkill({ ...input,
    sourceId: "script_agent_decision" as never, raw }), /not allowlisted/);
});
