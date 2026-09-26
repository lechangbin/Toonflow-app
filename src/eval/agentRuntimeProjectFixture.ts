import { createHash } from "node:crypto";

import type { DatabaseWork } from "@/database";
import { z } from "zod";

const id = z.number().int().positive();
const name = z.string().trim().min(1).max(200);
const content = z.string().trim().min(1).max(16_000);
const fixtureSchema = z.strictObject({
  schemaVersion: z.literal("toonflow.agent-runtime-project-fixture.v1"),
  project: z.strictObject({ name, ownerUserId: id }),
  novels: z.array(z.strictObject({ id, localId: name,
    chapterIndex: z.number().int().positive(), chapter: name, text: content })).min(1),
  events: z.array(z.strictObject({ id, localId: name,
    chapterLocalIds: z.array(name).min(1), name, detail: content })),
  scripts: z.array(z.strictObject({ id, localId: name, name, content })).min(1),
  scriptWorkspace: z.strictObject({ storySkeleton: content, adaptationStrategy: content }),
  productionWorkspace: z.strictObject({ scriptPlan: content, storyboardTable: content }),
});

function parseVerifiedFixture(source: string | Buffer, expectedHash: string) {
  const actualHash = createHash("sha256").update(source).digest("hex");
  if (actualHash !== expectedHash) throw new TypeError("Evaluation fixture hash differs");
  const fixture = fixtureSchema.parse(JSON.parse(source.toString()) as unknown);
  const novelIds = new Set(fixture.novels.map((item) => item.id));
  const localNovelIds = new Map(fixture.novels.map((item) => [item.localId, item.id]));
  if (novelIds.size !== fixture.novels.length || localNovelIds.size !== fixture.novels.length
    || new Set(fixture.novels.map((item) => item.chapterIndex)).size !== fixture.novels.length
    || new Set(fixture.events.map((item) => item.id)).size !== fixture.events.length
    || new Set(fixture.events.map((item) => item.localId)).size !== fixture.events.length
    || new Set(fixture.scripts.map((item) => item.id)).size !== fixture.scripts.length
    || fixture.events.some((item) => item.chapterLocalIds.some((chapter) => !localNovelIds.has(chapter)))) {
    throw new TypeError("Evaluation fixture identities or chapter links are invalid");
  }
  return { fixture, localNovelIds, actualHash };
}

export function inspectAgentRuntimeProjectFixtureSource(source: string | Buffer,
  expectedHash: string): { ownerUserId: number } {
  return { ownerUserId: parseVerifiedFixture(source, expectedHash).fixture.project.ownerUserId };
}

/** An evaluation-only adapter: writes the entire checked fixture into an otherwise empty database. */
export async function materializeAgentRuntimeProjectFixture(input: {
  work: DatabaseWork; source: string | Buffer; expectedHash: string; projectId: number;
}) {
  if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0) {
    throw new TypeError("Evaluation fixture Project ID must be positive");
  }
  const { fixture, localNovelIds, actualHash } = parseVerifiedFixture(input.source, input.expectedHash);
  await input.work((db) => db.transaction(async (tx) => {
    for (const table of ["o_project", "o_novel", "o_event", "o_eventChapter",
      "o_script", "o_agentWorkData"] as const) {
      if (await tx(table).first()) {
        throw new TypeError("Evaluation fixture requires an isolated database; Project or source already exists");
      }
    }
    await tx("o_project").insert({ id: input.projectId,
      userId: fixture.project.ownerUserId, name: fixture.project.name });
    await tx("o_novel").insert(fixture.novels.map((item) => ({ id: item.id,
      projectId: input.projectId, chapterIndex: item.chapterIndex,
      chapter: item.chapter, chapterData: item.text })));
    if (fixture.events.length) {
      await tx("o_event").insert(fixture.events.map((item) => ({ id: item.id,
        name: item.name, detail: item.detail })));
      let linkId = 30;
      await tx("o_eventChapter").insert(fixture.events.flatMap((item) =>
        item.chapterLocalIds.map((chapter) => ({ id: ++linkId,
          eventId: item.id, novelId: localNovelIds.get(chapter)! }))));
    }
    await tx("o_script").insert(fixture.scripts.map((item) => ({ id: item.id,
      projectId: input.projectId, name: item.name, content: item.content })));
    await tx("o_agentWorkData").insert([
      { id: 40, projectId: input.projectId, key: "scriptAgent",
        data: JSON.stringify(fixture.scriptWorkspace) },
      { id: 41, projectId: input.projectId, episodesId: fixture.scripts[0].id,
        key: "productionAgent", data: JSON.stringify(fixture.productionWorkspace) },
    ]);
  }));
  return { projectId: input.projectId, fixtureHash: actualHash,
    novelCount: fixture.novels.length, eventCount: fixture.events.length,
    scriptCount: fixture.scripts.length };
}

/** Recheck the materialized source/workspace projection before and after a v3 case. */
export async function verifyMaterializedAgentRuntimeProjectFixture(input: {
  work: DatabaseWork; source: string | Buffer; expectedHash: string; projectId: number;
}): Promise<void> {
  if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0) {
    throw new TypeError("Evaluation fixture Project ID must be positive");
  }
  const { fixture, localNovelIds } = parseVerifiedFixture(input.source, input.expectedHash);
  const actual = await input.work((db) => db.transaction(async (tx) => ({
    projects: await tx("o_project").orderBy("id").select("id", "userId", "name"),
    novels: await tx("o_novel").orderBy("id")
      .select("id", "projectId", "chapterIndex", "chapter", "chapterData"),
    events: await tx("o_event").orderBy("id").select("id", "name", "detail"),
    links: await tx("o_eventChapter").orderBy("id").select("id", "eventId", "novelId"),
    scripts: await tx("o_script").orderBy("id")
      .select("id", "projectId", "name", "content"),
    workData: await tx("o_agentWorkData").orderBy("id")
      .select("id", "projectId", "episodesId", "key", "data"),
  })));
  let linkId = 30;
  const expected = {
    projects: [{ id: input.projectId, userId: fixture.project.ownerUserId,
      name: fixture.project.name }],
    novels: fixture.novels.map((item) => ({ id: item.id, projectId: input.projectId,
      chapterIndex: item.chapterIndex, chapter: item.chapter, chapterData: item.text }))
      .sort((a, b) => a.id - b.id),
    events: fixture.events.map((item) => ({ id: item.id, name: item.name, detail: item.detail }))
      .sort((a, b) => a.id - b.id),
    links: fixture.events.flatMap((item) => item.chapterLocalIds.map((chapter) => ({
      id: ++linkId, eventId: item.id, novelId: localNovelIds.get(chapter)! }))),
    scripts: fixture.scripts.map((item) => ({ id: item.id, projectId: input.projectId,
      name: item.name, content: item.content })).sort((a, b) => a.id - b.id),
    workData: [{ id: 40, projectId: input.projectId, episodesId: null,
      key: "scriptAgent", data: JSON.stringify(fixture.scriptWorkspace) },
    { id: 41, projectId: input.projectId, episodesId: fixture.scripts[0].id,
      key: "productionAgent", data: JSON.stringify(fixture.productionWorkspace) }],
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError("Evaluation Project state differs from frozen fixture");
  }
}
