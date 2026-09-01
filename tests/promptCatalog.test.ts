import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory from "knex";

import {
  listPromptCatalog,
  readPromptCatalogEntry,
  resetPromptCatalogEntry,
  updatePromptCatalogEntry,
} from "../src/prompts/catalog";

const validVideoProfile = `---
id: test/profile-v1
schemaVersion: 1
capabilityId: text-to-video
defaultStrategy: standard
draftSections: [subject, motion]
attribution: test
---
# Test guidance

Keep the subject stable.`;

test("unifies database and Markdown prompts without weakening file boundaries", async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "toonflow-prompt-catalog-"));
  const database = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  const skillPath = path.join(dataRoot, "skills", "production_execution_storyboard_table.md");
  const profilePath = path.join(dataRoot, "promptProfiles", "test", "profile-v1.md");
  const modelPromptPath = path.join(dataRoot, "modelPrompt", "video", "demo.md");

  try {
    await database.schema.createTable("o_prompt", (table) => {
      table.increments("id");
      table.string("name");
      table.string("type").notNullable().unique();
      table.text("data");
      table.text("useData");
    });
    await database("o_prompt").insert({ name: "System prompt", type: "system-test", data: "default", useData: null });
    await fs.mkdir(path.dirname(skillPath), { recursive: true });
    await fs.mkdir(path.dirname(profilePath), { recursive: true });
    await fs.mkdir(path.dirname(modelPromptPath), { recursive: true });
    await fs.writeFile(skillPath, "# Storyboard table", "utf8");
    await fs.writeFile(profilePath, validVideoProfile, "utf8");
    await fs.writeFile(modelPromptPath, "# Model prompt", "utf8");

    const catalog = await listPromptCatalog(database, dataRoot);
    assert.deepEqual(
      new Set(catalog.map((entry) => entry.kind)),
      new Set(["system", "skill", "video-profile", "model-prompt"]),
    );

    await updatePromptCatalogEntry(database, dataRoot, "system:system-test", "custom");
    assert.equal(await readPromptCatalogEntry(database, dataRoot, "system:system-test"), "custom");
    await resetPromptCatalogEntry(database, "system:system-test");
    assert.equal(await readPromptCatalogEntry(database, dataRoot, "system:system-test"), "default");

    const skillKey = "skill:production_execution_storyboard_table.md";
    await updatePromptCatalogEntry(database, dataRoot, skillKey, "# Updated storyboard table");
    assert.equal(await readPromptCatalogEntry(database, dataRoot, skillKey), "# Updated storyboard table");

    await assert.rejects(
      updatePromptCatalogEntry(database, dataRoot, "skill:../outside.md", "unsafe"),
      /超出允许范围|不存在/,
    );

    await assert.rejects(
      updatePromptCatalogEntry(database, dataRoot, "video-profile:test/profile-v1.md", "# invalid"),
      /expected frontmatter/,
    );
    assert.equal(await fs.readFile(profilePath, "utf8"), validVideoProfile);
  } finally {
    await database.destroy();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
});
