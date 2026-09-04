import assert from "node:assert/strict";
import fs from "node:fs";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import express, { type Router } from "express";
import knexFactory, { type Knex } from "knex";

import { openDatabase } from "../src/database";
import initDB from "../src/lib/initDB";
import { withDataRoot, workOf } from "./databaseTestSupport";
import extractAssetsRoute from "../src/routes/script/extractAssets";
import type { BaseAssetCandidate } from "../src/script/assetExtractionContract";
import { createDefaultBaseAssetSkillFileLoader } from "../src/script/baseAssetExtraction";
import {
  executeScriptAssetExtraction,
  replaceScriptAssetExtraction,
  type ScriptAssetExtractionDependencies,
} from "../src/script/assetExtractionReplacement";

const SCRIPT_1 = [
  "章台宫内，年轻的秦二世胡亥面对堆叠奏牍，身居帝位却在赵高逼视下反复迟疑。",
  "赵高立于阶下，垂目不语，殿中只有烛火声。",
  "胡亥开口：“朕已依师之言，尽诛大臣。”",
].join("\n");

const SCRIPT_2 = [
  "大泽乡戍卒营地，连日暴雨。吴广与同伴检查误期名册木牍，粗麻短褐被雨水浸透。",
  "陈胜对众人说：“今亡亦死，举大计亦死。”",
].join("\n");

function candidate(overrides: Partial<BaseAssetCandidate> & { canonicalName: string }): BaseAssetCandidate {
  const firstScriptId = overrides.scriptIds?.[0] ?? 1;
  return {
    type: "role",
    aliases: [],
    summary: `${overrides.canonicalName}的剧本内身份摘要。`,
    scriptIds: [1],
    evidence: [
      {
        scriptId: firstScriptId,
        excerpt:
          firstScriptId === 2
            ? "大泽乡戍卒营地，连日暴雨"
            : "章台宫内，年轻的秦二世胡亥面对堆叠奏牍",
        locator: "第1场",
      },
    ],
    identityFacts: undefined,
    ...overrides,
  } as BaseAssetCandidate;
}

const EMPTY_AUDIT = () => ({ additions: [], factAdditions: [], typeCorrections: [], aliasProposals: [] });

interface FakeResultTool {
  execute?: (raw: unknown, options: unknown) => Promise<unknown>;
}

function fakeTextCall(
  extractionOutput: () => unknown,
  auditOutput: () => unknown,
  counters: { opened: number; invoked: number } = { opened: 0, invoked: 0 },
): () => Promise<{ invoke: (input: { tools: Record<string, unknown> }) => Promise<void> }> {
  return async () => {
    counters.opened += 1;
    let invokedInCall = 0;
    return {
      invoke: async (input: { tools: Record<string, unknown> }) => {
        counters.invoked += 1;
        invokedInCall += 1;
        const resultTool = input.tools.resultTool as FakeResultTool | undefined;
        assert.ok(resultTool?.execute, "模型调用必须携带 resultTool 工具");
        const payload = invokedInCall === 1 ? extractionOutput() : auditOutput();
        await resultTool.execute(payload, { toolCallId: `t${counters.invoked}`, messages: [] });
      },
    };
  };
}

interface Harness {
  deps: (overrides?: Partial<ScriptAssetExtractionDependencies>) => ScriptAssetExtractionDependencies;
  knex: Knex;
  deletedMediaPaths: string[];
  logs: Record<string, unknown>[];
  cleanup: () => Promise<void>;
}

async function createHarness(): Promise<Harness> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-asset-replacement-"));
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(directory, "db.sqlite") },
    useNullAsDefault: true,
  });
  await knex.raw("PRAGMA foreign_keys = OFF");
  await knex.schema.createTable("o_skillList", (table) => table.text("id").primary());
  await initDB(knex);
  await knex("o_project").insert({ id: 7, name: "秦末项目", type: "短剧", intro: "秦末故事" });
  await knex("o_script").insert([
    { id: 1, name: "第一章 章台宫", content: SCRIPT_1, projectId: 7, extractState: 1, createTime: 1 },
    { id: 2, name: "第二章 大泽乡", content: SCRIPT_2, projectId: 7, extractState: 1, createTime: 2 },
  ]);
  const work = workOf(knex);
  const logs: Record<string, unknown>[] = [];
  const deletedMediaPaths: string[] = [];
  const base: ScriptAssetExtractionDependencies = {
    work,
    openTextCall: fakeTextCall(
      () => ({ assets: [] }),
      () => ({ additions: [], factAdditions: [], typeCorrections: [], aliasProposals: [] }),
    ),
    loadSkillFile: createDefaultBaseAssetSkillFileLoader(),
    now: () => 1700000000000,
    log: (entry) => logs.push(entry),
    deleteMediaFile: async (mediaPath) => {
      deletedMediaPaths.push(mediaPath);
    },
  };
  return {
    deps: (overrides) => ({ ...base, ...overrides }),
    knex,
    deletedMediaPaths,
    logs,
    cleanup: async () => {
      await knex.destroy();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** 首次提取：为剧本 seed 一组资产与身份记录。 */
async function runFirstExtraction(harness: Harness, assets: BaseAssetCandidate[], scriptIds: number[]) {
  const deps = harness.deps({
    openTextCall: fakeTextCall(() => ({ assets }), EMPTY_AUDIT),
  });
  const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds });
  assert.equal(outcome.ok, true, "首次提取必须成功");
}

async function assetIdByName(harness: Harness, name: string): Promise<number | undefined> {
  const row = await harness.knex("o_assets").where({ projectId: 7, name }).first();
  return row?.id;
}

interface DownstreamSeed {
  assetId: number;
  scriptId?: number;
  storyboard?: boolean;
  video?: boolean;
  reference?: boolean;
  promptRecord?: boolean;
  changeInstruction?: boolean;
  image?: boolean;
  imageFlow?: boolean;
}

/** 为一个资产生成全套下游关系：剧本/分镜关联、参考图、提示词、变化契约、图片、图片流、视频。 */
async function seedDownstream(harness: Harness, seed: DownstreamSeed) {
  const knex = harness.knex;
  if (seed.scriptId !== undefined) {
    const existing = await knex("o_scriptAssets").where({ scriptId: seed.scriptId, assetId: seed.assetId }).first();
    if (!existing) await knex("o_scriptAssets").insert({ scriptId: seed.scriptId, assetId: seed.assetId });
  }
  if (seed.reference) {
    await knex("o_assetReference").insert({
      projectId: 7,
      assetsId: seed.assetId,
      mediaPath: `/7/assetReferences/${seed.assetId}.png`,
      mediaMime: "image/png",
      orderIndex: 0,
    });
  }
  if (seed.promptRecord) {
    await knex("o_assetPromptRecord").insert({ projectId: 7, assetsId: seed.assetId });
  }
  if (seed.changeInstruction) {
    await knex("o_derivedChangeInstruction").insert({ projectId: 7, assetsId: seed.assetId, source: "productionAgent" });
  }
  if (seed.imageFlow) {
    const [flowId] = await knex("o_imageFlow").insert({ flowData: "{}" });
    await knex("o_assets").where("id", seed.assetId).update({ flowId });
  }
  if (seed.image) {
    await knex("o_image").insert({
      filePath: `/7/assets/${seed.assetId}.jpg`,
      type: "asset",
      assetsId: seed.assetId,
      state: "done",
    });
  }
  if (seed.storyboard) {
    const [storyboardId] = await knex("o_storyboard").insert({
      scriptId: seed.scriptId ?? 1,
      prompt: "全景，章台宫内胡亥面对奏牍",
      filePath: "/7/storyboard/1.jpg",
      duration: "4",
      state: "已完成",
      projectId: 7,
      index: 1,
      createTime: 1,
      shouldGenerateImage: 1,
    });
    await knex("o_assets2Storyboard").insert({ storyboardId, assetId: seed.assetId });
    if (seed.video) {
      const [trackId] = await knex("o_videoTrack").insert({
        projectId: 7,
        scriptId: seed.scriptId ?? 1,
        state: "已完成",
      });
      const [artifactRevisionId] = await knex("o_artifactRevision").insert({
        actionId: 1,
        generationTaskId: 1,
        videoId: 0,
        videoTrackId: trackId,
        revision: 1,
        status: "accepted",
        createdAt: 1,
      });
      const [videoId] = await knex("o_video").insert({
        filePath: `/7/video/${trackId}.mp4`,
        state: "生成成功",
        scriptId: seed.scriptId ?? 1,
        projectId: 7,
        videoTrackId: trackId,
        artifactRevisionId,
      });
      await knex("o_artifactRevision").where("id", artifactRevisionId).update({ videoId });
      await knex("o_videoTrack").where("id", trackId).update({ videoId });
      await knex("o_storyboard").where("id", storyboardId).update({ trackId });
    }
    return storyboardId;
  }
  return undefined;
}

/** 在替换事务内对指定表的第 N 次访问注入失败，验证全部回滚。 */
function workWithTrxTableFailure(knex: Knex, table: string, occurrence: number) {
  let hits = 0;
  return async <T>(operation: (db: Knex) => Promise<T> | T): Promise<T> => {
    const wrapped = ((name: string) => knex(name)) as unknown as Knex;
    (wrapped as unknown as Record<string, unknown>).transaction = (fn: (trx: Knex) => unknown) =>
      knex.transaction(async (trx: Knex.Transaction) => fn(trappingTrxOf(trx, table, occurrence, () => (hits += 1))));
    return operation(wrapped);
  };
}

function trappingTrxOf(trx: Knex.Transaction, table: string, occurrence: number, nextHit: () => number): Knex {
  return new Proxy(trx, {
    apply(target: unknown, _thisArg: unknown, args: unknown[]) {
      if (args[0] === table && nextHit() === occurrence) throw new Error("注入的替换事务失败");
      return Reflect.apply(target as never, target as never, args as never);
    },
    get(target: unknown, prop: string) {
      const value = (target as Record<string, unknown>)[prop];
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  }) as unknown as Knex;
}

// ---------------------------------------------------------------------------
// 1/2 确认门禁：已有资产 + 无替换意图 → 409 稳定错误，零模型调用
// ---------------------------------------------------------------------------

test("已有资产的剧本在缺少 replaceExisting 时拒绝提取且零模型调用、零状态变更", async () => {
  const harness = await createHarness();
  try {
    await runFirstExtraction(harness, [candidate({ canonicalName: "胡亥" })], [1]);
    const huId = (await assetIdByName(harness, "胡亥"))!;
    assert.ok(huId, "前置：首次提取已生成资产");
    const counters = { opened: 0, invoked: 0 };
    const deps = harness.deps({
      openTextCall: fakeTextCall(() => ({ assets: [candidate({ canonicalName: "新角色" })] }), EMPTY_AUDIT, counters),
    });

    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1] });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "reextractConfirmationRequired");

    assert.equal(counters.opened, 0, "确认缺失时不打开 Text Model");
    assert.equal(counters.invoked, 0, "确认缺失时不执行任何模型调用");
    const states = await harness.knex("o_script").where("id", 1).select("extractState", "errorReason");
    assert.equal(states[0].extractState, 1, "拒绝不改变剧本提取状态");
    assert.equal(states[0].errorReason, null);
    assert.ok(await harness.knex("o_assets").where("id", huId).first(), "旧资产保持不变");
    assert.ok((await harness.knex("o_scriptAssets").where({ scriptId: 1, assetId: huId })).length > 0, "旧关联保持不变");
  } finally {
    await harness.cleanup();
  }
});

test("显式 replaceExisting 时正常执行替换", async () => {
  const harness = await createHarness();
  try {
    const counters = { opened: 0, invoked: 0 };
    const deps = harness.deps({
      openTextCall: fakeTextCall(() => ({ assets: [candidate({ canonicalName: "赵高" })] }), EMPTY_AUDIT, counters),
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1], replaceExisting: true });
    assert.equal(outcome.ok, true);
    assert.equal(counters.invoked, 2, "两次 Text Model 调用");
    assert.ok(await assetIdByName(harness, "赵高"), "新资产已写入");
  } finally {
    await harness.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 3/4 先生成后替换：模型或校验失败保留全部旧数据
// ---------------------------------------------------------------------------

async function assertDownstreamIntact(harness: Harness, seeded: { assetId: number; storyboardId?: number }) {
  const { knex } = harness;
  assert.ok(await knex("o_assets").where("id", seeded.assetId).first(), "旧资产保留");
  assert.ok((await knex("o_scriptAssets").where({ assetId: seeded.assetId })).length > 0, "旧剧本关联保留");
  assert.ok((await knex("o_assetReference").where({ assetsId: seeded.assetId })).length > 0, "参考图行保留");
  assert.ok((await knex("o_assetPromptRecord").where({ assetsId: seeded.assetId })).length > 0, "提示词记录保留");
  assert.ok((await knex("o_derivedChangeInstruction").where({ assetsId: seeded.assetId })).length > 0, "变化契约保留");
  assert.ok((await knex("o_image").where({ assetsId: seeded.assetId })).length > 0, "图片记录保留");
  if (seeded.storyboardId) {
    const storyboard = await knex("o_storyboard").where("id", seeded.storyboardId).first();
    assert.equal(storyboard.state, "已完成", "分镜图片状态保留");
    assert.equal(storyboard.filePath, "/7/storyboard/1.jpg", "分镜图片保留");
    assert.ok((await knex("o_assets2Storyboard").where({ storyboardId: seeded.storyboardId })).length > 0, "分镜关联保留");
    const track = await knex("o_videoTrack").where("id", storyboard.trackId).first();
    assert.equal(track.state, "已完成", "视频轨道保留");
    const video = await knex("o_video").where("videoTrackId", track.id).first();
    assert.equal(video.state, "生成成功", "视频结果保留");
    const revision = await knex("o_artifactRevision").where("id", video.artifactRevisionId).first();
    assert.equal(revision.status, "accepted", "Artifact Revision 保留");
  }
}

test("模型调用失败时旧资产与全部下游数据完全保留", async () => {
  const harness = await createHarness();
  try {
    await runFirstExtraction(harness, [candidate({ canonicalName: "胡亥" })], [1]);
    const huId = (await assetIdByName(harness, "胡亥"))!;
    const storyboardId = (await seedDownstream(harness, {
      assetId: huId,
      scriptId: 1,
      storyboard: true,
      video: true,
      reference: true,
      promptRecord: true,
      changeInstruction: true,
      image: true,
      imageFlow: true,
    }))!;
    const deps = harness.deps({
      openTextCall: async () => {
        throw new Error("模型调用网络失败");
      },
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1], replaceExisting: true });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "modelCallFailed");
    await assertDownstreamIntact(harness, { assetId: huId, storyboardId });
    assert.equal(harness.deletedMediaPaths.length, 0, "失败时不得删除任何媒体文件");
    const state = await harness.knex("o_script").where("id", 1).select("extractState");
    assert.equal(state[0].extractState, -1, "失败回写提取状态");
  } finally {
    await harness.cleanup();
  }
});

test("证据校验失败时旧资产与全部下游数据完全保留", async () => {
  const harness = await createHarness();
  try {
    await runFirstExtraction(harness, [candidate({ canonicalName: "胡亥" })], [1]);
    const huId = (await assetIdByName(harness, "胡亥"))!;
    const storyboardId = (await seedDownstream(harness, {
      assetId: huId,
      scriptId: 1,
      storyboard: true,
      video: true,
      reference: true,
      promptRecord: true,
      changeInstruction: true,
      image: true,
      imageFlow: true,
    }))!;
    const deps = harness.deps({
      openTextCall: fakeTextCall(
        () => ({
          assets: [
            candidate({
              canonicalName: "伪证据",
              evidence: [{ scriptId: 1, excerpt: "剧本中不存在的证据", locator: "第1场" }],
            }),
          ],
        }),
        EMPTY_AUDIT,
      ),
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1], replaceExisting: true });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "invalidOutput");
    await assertDownstreamIntact(harness, { assetId: huId, storyboardId });
  } finally {
    await harness.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 5 替换事务失败 → 全部回滚
// ---------------------------------------------------------------------------

test("替换事务中途失败时回滚全部写入，旧数据完整保留", async () => {
  const harness = await createHarness();
  try {
    await runFirstExtraction(harness, [candidate({ canonicalName: "胡亥" })], [1]);
    const huId = (await assetIdByName(harness, "胡亥"))!;
    const storyboardId = (await seedDownstream(harness, {
      assetId: huId,
      scriptId: 1,
      storyboard: true,
      video: true,
      reference: true,
      promptRecord: true,
      changeInstruction: true,
      image: true,
    }))!;
    const assetsBefore = await harness.knex("o_assets").where("projectId", 7).select("id");
    const linksBefore = await harness.knex("o_scriptAssets").select("*");

    const deps = harness.deps({
      work: workWithTrxTableFailure(harness.knex, "o_assets2Storyboard", 1),
      openTextCall: fakeTextCall(() => ({ assets: [candidate({ canonicalName: "赵高" })] }), EMPTY_AUDIT),
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1], replaceExisting: true });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "persistenceFailed");

    const assetsAfter = await harness.knex("o_assets").where("projectId", 7).select("id");
    assert.deepEqual(
      assetsAfter.map((a) => a.id).sort(),
      assetsBefore.map((a) => a.id).sort(),
      "事务失败后资产集合不变",
    );
    assert.deepEqual(await harness.knex("o_scriptAssets").select("*"), linksBefore, "剧本关联不变");
    await assertDownstreamIntact(harness, { assetId: huId, storyboardId });
    assert.equal((await harness.knex("o_image")).length, 1, "图片记录不变");
  } finally {
    await harness.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 6/7/8/9 混合新旧资产、共享资产、同名身份、人工孤儿
// ---------------------------------------------------------------------------

test("替换混合复用旧身份与创建新资产，未复用的旧资产成为孤儿删除", async () => {
  const harness = await createHarness();
  try {
    await runFirstExtraction(
      harness,
      [
        candidate({ canonicalName: "胡亥", identityFacts: { occupation: "秦二世" } }),
        candidate({ canonicalName: "赵高", identityFacts: { occupation: "中车府令" } }),
      ],
      [1],
    );
    const huId = (await assetIdByName(harness, "胡亥"))!;
    const zhaoId = (await assetIdByName(harness, "赵高"))!;

    const deps = harness.deps({
      openTextCall: fakeTextCall(
        () => ({
          assets: [
            candidate({ canonicalName: "胡亥", identityFacts: { occupation: "秦二世" } }),
            candidate({ canonicalName: "李斯", identityFacts: { occupation: "丞相" } }),
          ],
        }),
        EMPTY_AUDIT,
      ),
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1], replaceExisting: true });
    assert.equal(outcome.ok, true);

    assert.equal(await assetIdByName(harness, "胡亥"), huId, "证据支持的既有身份被复用");
    assert.ok(await assetIdByName(harness, "李斯"), "新资产已创建");
    assert.equal(await harness.knex("o_assets").where("id", zhaoId).first(), undefined, "未复用的旧资产被删除");
    assert.equal(await harness.knex("o_assetIdentity").where("assetsId", zhaoId).first(), undefined, "旧身份记录随之删除");
    const links = await harness.knex("o_scriptAssets").where("scriptId", 1);
    assert.deepEqual(
      links.map((l) => l.assetId).sort(),
      [huId, await assetIdByName(harness, "李斯")].sort(),
      "剧本关联被替换为最终结果",
    );
  } finally {
    await harness.cleanup();
  }
});

test("被未选剧本使用的共享资产保留且在新结果命中同一身份时复用", async () => {
  const harness = await createHarness();
  try {
    await runFirstExtraction(harness, [candidate({ canonicalName: "胡亥", identityFacts: { occupation: "秦二世" } })], [1]);
    const huId = (await assetIdByName(harness, "胡亥"))!;
    await harness.knex("o_scriptAssets").insert({ scriptId: 2, assetId: huId });

    const deps = harness.deps({
      openTextCall: fakeTextCall(
        () => ({ assets: [candidate({ canonicalName: "陈胜", scriptIds: [2] })] }),
        EMPTY_AUDIT,
      ),
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [2], replaceExisting: true });
    assert.equal(outcome.ok, true);

    assert.equal(await assetIdByName(harness, "胡亥"), huId, "仍被剧本 1 使用的共享资产保留");
    assert.ok(
      (await harness.knex("o_scriptAssets").where({ scriptId: 1, assetId: huId })).length > 0,
      "未选剧本的关联保留",
    );
  } finally {
    await harness.cleanup();
  }
});

test("同名但身份证据不足的资产不误合并，各自保持独立", async () => {
  const harness = await createHarness();
  try {
    // 剧本 2 已提取出 李信（身份证据只指向剧本 2）
    await runFirstExtraction(harness, [candidate({ canonicalName: "李信", scriptIds: [2] })], [2]);
    const existingId = (await assetIdByName(harness, "李信"))!;

    // 剧本 1 首次提取：同名 李信 证据只指向剧本 1，身份不相交不得合并
    const deps = harness.deps({
      openTextCall: fakeTextCall(() => ({ assets: [candidate({ canonicalName: "李信", scriptIds: [1] })] }), EMPTY_AUDIT),
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1] });
    assert.equal(outcome.ok, true);

    const sameName = await harness.knex("o_assets").where({ projectId: 7, name: "李信" });
    assert.equal(sameName.length, 2, "同名不同身份保持两个资产");
    assert.ok(sameName.some((a) => a.id === existingId), "旧 李信 保留");
    assert.ok(
      (await harness.knex("o_scriptAssets").where({ scriptId: 2, assetId: existingId })).length > 0,
      "旧资产的剧本 2 关联保留",
    );
  } finally {
    await harness.cleanup();
  }
});

test("人工创建的孤儿资产无论来源都被删除", async () => {
  const harness = await createHarness();
  try {
    await runFirstExtraction(harness, [candidate({ canonicalName: "胡亥" })], [1]);
    const [manualId] = await harness.knex("o_assets").insert({
      name: "人工资产",
      type: "role",
      describe: "人工创建",
      projectId: 7,
      startTime: 1,
    });
    await seedDownstream(harness, {
      assetId: manualId,
      scriptId: 1,
      storyboard: true,
      reference: true,
      promptRecord: true,
      changeInstruction: true,
      image: true,
    });

    const deps = harness.deps({
      openTextCall: fakeTextCall(() => ({ assets: [candidate({ canonicalName: "胡亥" })] }), EMPTY_AUDIT),
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1], replaceExisting: true });
    assert.equal(outcome.ok, true);

    assert.equal(await harness.knex("o_assets").where("id", manualId).first(), undefined, "人工孤儿资产被删除");
    assert.equal(await harness.knex("o_scriptAssets").where("assetId", manualId).first(), undefined, "其剧本关联被删除");
  } finally {
    await harness.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 10/11 Derived children 与下游关系级联清理
// ---------------------------------------------------------------------------

test("孤儿 Base Asset 的 Derived children 完整级联删除", async () => {
  const harness = await createHarness();
  try {
    await runFirstExtraction(harness, [candidate({ canonicalName: "胡亥" })], [1]);
    const huId = (await assetIdByName(harness, "胡亥"))!;
    const [childId] = await harness.knex("o_assets").insert({
      name: "胡亥·雨夜",
      type: "role",
      describe: "衍生资产",
      projectId: 7,
      assetsId: huId,
      startTime: 1,
    });
    await seedDownstream(harness, {
      assetId: childId,
      scriptId: 1,
      storyboard: true,
      reference: true,
      promptRecord: true,
      changeInstruction: true,
      image: true,
      imageFlow: true,
    });
    const [grandChildId] = await harness.knex("o_assets").insert({
      name: "胡亥·雨夜·负伤",
      type: "role",
      projectId: 7,
      assetsId: childId,
      startTime: 1,
    });
    await harness.knex("o_scriptAssets").insert({ scriptId: 1, assetId: grandChildId });

    const deps = harness.deps({
      openTextCall: fakeTextCall(() => ({ assets: [candidate({ canonicalName: "赵高" })] }), EMPTY_AUDIT),
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1], replaceExisting: true });
    assert.equal(outcome.ok, true);

    for (const id of [huId, childId, grandChildId]) {
      assert.equal(await harness.knex("o_assets").where("id", id).first(), undefined, `资产 ${id} 级联删除`);
      assert.equal(await harness.knex("o_assetIdentity").where("assetsId", id).first(), undefined, `身份记录 ${id} 删除`);
      assert.equal(await harness.knex("o_scriptAssets").where("assetId", id).first(), undefined, `剧本关联 ${id} 删除`);
      assert.equal(
        await harness.knex("o_assets2Storyboard").where("assetId", id).first(),
        undefined,
        `分镜关联 ${id} 删除`,
      );
      assert.equal(await harness.knex("o_image").where("assetsId", id).first(), undefined, `图片 ${id} 删除`);
    }
    const flowId = (await harness.knex("o_assets").where("id", childId).first())?.flowId;
    assert.equal(flowId, undefined, "读取已删除行返回 undefined");
  } finally {
    await harness.cleanup();
  }
});

test("references/images/prompts/image-flow/change instructions 全部清理并收集媒体路径", async () => {
  const harness = await createHarness();
  try {
    await runFirstExtraction(harness, [candidate({ canonicalName: "胡亥" })], [1]);
    const huId = (await assetIdByName(harness, "胡亥"))!;
    await seedDownstream(harness, {
      assetId: huId,
      scriptId: 1,
      reference: true,
      promptRecord: true,
      changeInstruction: true,
      image: true,
      imageFlow: true,
    });
    const flowRow = await harness.knex("o_assets").where("id", huId).first();

    const deps = harness.deps({
      openTextCall: fakeTextCall(() => ({ assets: [candidate({ canonicalName: "赵高" })] }), EMPTY_AUDIT),
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1], replaceExisting: true });
    assert.equal(outcome.ok, true);

    assert.equal(await harness.knex("o_assetReference").where("assetsId", huId).first(), undefined);
    assert.equal(await harness.knex("o_assetPromptRecord").where("assetsId", huId).first(), undefined);
    assert.equal(await harness.knex("o_derivedChangeInstruction").where("assetsId", huId).first(), undefined);
    assert.equal(await harness.knex("o_image").where("assetsId", huId).first(), undefined);
    assert.equal(await harness.knex("o_imageFlow").where("id", flowRow.flowId).first(), undefined, "图片工作流记录删除");
    assert.deepEqual(
      harness.deletedMediaPaths.sort(),
      [`/7/assetReferences/${huId}.png`, `/7/assets/${huId}.jpg`].sort(),
      "提交后尽力删除参考图与资产生成图",
    );
  } finally {
    await harness.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 12/13/14 Storyboard 保留与失效
// ---------------------------------------------------------------------------

test("分镜文本与镜头结构保留，无效关联移除，图片与视频状态失效", async () => {
  const harness = await createHarness();
  try {
    await runFirstExtraction(
      harness,
      [candidate({ canonicalName: "胡亥" }), candidate({ canonicalName: "赵高" })],
      [1],
    );
    const huId = (await assetIdByName(harness, "胡亥"))!;
    const zhaoId = (await assetIdByName(harness, "赵高"))!;
    const affectedStoryboardId = (await seedDownstream(harness, {
      assetId: huId,
      scriptId: 1,
      storyboard: true,
      video: true,
    }))!;
    // 赵高保留在新结果中：其分镜必须完全不动
    const keptStoryboardId = (await seedDownstream(harness, {
      assetId: zhaoId,
      scriptId: 1,
      storyboard: true,
      video: true,
    }))!;

    const deps = harness.deps({
      openTextCall: fakeTextCall(() => ({ assets: [candidate({ canonicalName: "赵高" })] }), EMPTY_AUDIT),
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1], replaceExisting: true });
    assert.equal(outcome.ok, true);

    const affected = await harness.knex("o_storyboard").where("id", affectedStoryboardId).first();
    assert.equal(affected.prompt, "全景，章台宫内胡亥面对奏牍", "分镜文本保留");
    assert.equal(affected.videoDesc, null, "分镜结构字段保留");
    assert.equal(affected.index, 1, "分镜顺序保留");
    assert.equal(affected.duration, "4", "分镜时长保留");
    assert.equal(affected.filePath, "", "依赖旧资产的分镜图片被清除");
    assert.equal(affected.state, "未生成", "分镜图片标记为未生成");
    assert.equal(
      await harness.knex("o_assets2Storyboard").where({ storyboardId: affectedStoryboardId, assetId: huId }).first(),
      undefined,
      "指向已删除资产的分镜关联移除",
    );

    const affectedTrack = await harness.knex("o_videoTrack").where("id", affected.trackId).first();
    assert.equal(affectedTrack.state, "已过期", "受影响视频轨道标记为已过期");
    assert.equal(affectedTrack.videoId, null, "轨道不再选中旧视频");
    const affectedVideo = await harness.knex("o_video").where("videoTrackId", affected.trackId).first();
    assert.equal(affectedVideo.state, "已过期", "旧视频结果标记为已过期");
    const affectedRevision = await harness.knex("o_artifactRevision").where("id", affectedVideo.artifactRevisionId).first();
    assert.equal(affectedRevision.status, "rejected", "旧 Artifact Revision 被拒绝，不可再被采纳");

    const kept = await harness.knex("o_storyboard").where("id", keptStoryboardId).first();
    assert.equal(kept.filePath, "/7/storyboard/1.jpg", "保留资产的分镜图片不动");
    assert.equal(kept.state, "已完成", "保留资产的分镜状态不动");
    assert.ok(
      (await harness.knex("o_assets2Storyboard").where({ storyboardId: keptStoryboardId, assetId: zhaoId })).length > 0,
      "保留资产的分镜关联不动",
    );
    const keptTrack = await harness.knex("o_videoTrack").where("id", kept.trackId).first();
    assert.equal(keptTrack.state, "已完成", "保留资产的视频轨道不动");
  } finally {
    await harness.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 15/16 并发与重试
// ---------------------------------------------------------------------------

test("两次并发确认只有一次进入模型调用与替换", async () => {
  const harness = await createHarness();
  try {
    await runFirstExtraction(harness, [candidate({ canonicalName: "胡亥" })], [1]);
    const counters = { opened: 0, invoked: 0 };
    const deps = harness.deps({
      openTextCall: fakeTextCall(() => ({ assets: [candidate({ canonicalName: "赵高" })] }), EMPTY_AUDIT, counters),
    });

    const outcomes = await Promise.all([
      executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1], replaceExisting: true }),
      executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1], replaceExisting: true }),
    ]);

    assert.equal(outcomes.filter((o) => o.ok).length, 1, "只有一个请求成功占用");
    assert.equal(outcomes.filter((o) => o.error === "extractionInProgress").length, 1, "另一个请求稳定失败");
    assert.equal(counters.opened, 1, "只打开一次 Text Model 目标");
    assert.equal(counters.invoked, 2, "只执行两次模型调用");
    assert.equal((await harness.knex("o_assets").where({ projectId: 7, name: "赵高" })).length, 1, "不产生重复替换");
  } finally {
    await harness.cleanup();
  }
});

test("首次失败后可以安全重试并完成替换", async () => {
  const harness = await createHarness();
  try {
    await runFirstExtraction(harness, [candidate({ canonicalName: "胡亥" })], [1]);
    const failing = harness.deps({
      openTextCall: async () => {
        throw new Error("第一次失败");
      },
    });
    const first = await executeScriptAssetExtraction(failing, { projectId: 7, scriptIds: [1], replaceExisting: true });
    assert.equal(first.ok, false);

    const retrying = harness.deps({
      openTextCall: fakeTextCall(() => ({ assets: [candidate({ canonicalName: "赵高" })] }), EMPTY_AUDIT),
    });
    const second = await executeScriptAssetExtraction(retrying, { projectId: 7, scriptIds: [1], replaceExisting: true });
    assert.equal(second.ok, true, "失败后可安全重试");
    assert.ok(await assetIdByName(harness, "赵高"));
    assert.equal(await assetIdByName(harness, "胡亥"), undefined, "重试仍完成孤儿清理");
    const state = await harness.knex("o_script").where("id", 1).select("extractState", "errorReason");
    assert.equal(state[0].extractState, 1);
    assert.equal(state[0].errorReason, null);
  } finally {
    await harness.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 17 提交后媒体清理失败不破坏数据库结果
// ---------------------------------------------------------------------------

test("提交后媒体清理失败只记录结构化日志，不破坏数据库替换结果", async () => {
  const harness = await createHarness();
  try {
    await runFirstExtraction(harness, [candidate({ canonicalName: "胡亥" })], [1]);
    const huId = (await assetIdByName(harness, "胡亥"))!;
    await seedDownstream(harness, {
      assetId: huId,
      scriptId: 1,
      reference: true,
      image: true,
    });

    const deps = harness.deps({
      openTextCall: fakeTextCall(() => ({ assets: [candidate({ canonicalName: "赵高" })] }), EMPTY_AUDIT),
      deleteMediaFile: async () => {
        throw new Error("文件被占用");
      },
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1], replaceExisting: true });
    assert.equal(outcome.ok, true, "媒体清理失败不影响提取结果");

    assert.equal(await harness.knex("o_assets").where("id", huId).first(), undefined, "数据库替换结果保持");
    assert.equal(await harness.knex("o_image").where("assetsId", huId).first(), undefined);
    assert.ok(
      harness.logs.some((entry) => entry.kind === "mediaCleanupFailed"),
      "清理失败记录结构化日志",
    );
    for (const entry of harness.logs.filter((e) => e.kind === "mediaCleanupFailed")) {
      assert.equal(typeof entry.mediaPath, "string");
      assert.ok(!JSON.stringify(entry).includes("scriptContent"), "日志不包含剧本正文");
    }
  } finally {
    await harness.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 领域模块接口：replaceScriptAssetExtraction 的直接契约
// ---------------------------------------------------------------------------

test("replaceScriptAssetExtraction 返回复用/新建/删除/失效明细", async () => {
  const harness = await createHarness();
  try {
    await runFirstExtraction(
      harness,
      [
        candidate({ canonicalName: "胡亥", identityFacts: { occupation: "秦二世" } }),
        candidate({ canonicalName: "赵高" }),
      ],
      [1],
    );
    const huId = (await assetIdByName(harness, "胡亥"))!;
    const zhaoId = (await assetIdByName(harness, "赵高"))!;
    const storyboardId = (await seedDownstream(harness, { assetId: zhaoId, scriptId: 1, storyboard: true, video: true }))!;

    const deps = harness.deps({
      openTextCall: fakeTextCall(
        () => ({ assets: [candidate({ canonicalName: "胡亥", identityFacts: { occupation: "秦二世" } })] }),
        EMPTY_AUDIT,
      ),
    });
    const staged = await import("../src/script/baseAssetExtraction").then((m) =>
      m.runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1] }),
    );
    const result = await replaceScriptAssetExtraction(deps, staged);

    assert.deepEqual(result.reusedAssetIds, [huId]);
    assert.equal(result.createdAssetIds.length, 0);
    assert.deepEqual(result.deletedAssetIds, [zhaoId]);
    assert.deepEqual(result.affectedStoryboardIds, [storyboardId]);
    const trackId = (await harness.knex("o_storyboard").where("id", storyboardId).first()).trackId;
    assert.deepEqual(result.staleVideoTrackIds, [trackId]);
  } finally {
    await harness.cleanup();
  }
});

// ---------------------------------------------------------------------------
// HTTP 路由契约
// ---------------------------------------------------------------------------

function createApp(router: Router): express.Express {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

async function postJson(app: express.Express, body: unknown): Promise<{ status: number; body: any }> {
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("路由契约：已有资产且无 replaceExisting 返回 409 reextractConfirmationRequired", { timeout: 120000 }, async () => {
  await withDataRoot("toonflow-replacement-route-", async () => {
    const runtime = await openDatabase();
    await runtime.work(async (db) => {
      await db("o_project").insert({ id: 7, name: "秦末项目" });
      await db("o_script").insert({
        id: 1,
        name: "第一章",
        content: "章台宫内，胡亥面对奏牍。",
        projectId: 7,
        extractState: 1,
      });
      const [assetId] = await db("o_assets").insert({ name: "胡亥", type: "role", projectId: 7, startTime: 1 });
      await db("o_scriptAssets").insert({ scriptId: 1, assetId });
    });

    const app = createApp(extractAssetsRoute);
    const rejected = await postJson(app, { scriptIds: [1], projectId: 7 });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.code, 409);
    assert.equal(rejected.body.message, "当前操作会删除当前已有资产，请确认是否提取");
    assert.equal(rejected.body.error, "reextractConfirmationRequired");
    assert.equal(rejected.body.data, null);

    const rows = await runtime.work((db) => db("o_script").where("id", 1).select("extractState"));
    assert.equal(rows[0].extractState, 1, "409 不改变任何数据库状态");

    const accepted = await postJson(app, { scriptIds: [1], projectId: 7, replaceExisting: true });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.data, "开始提取资产");
  });
});

test("路由契约：提取进行中返回 409 extractionInProgress", { timeout: 120000 }, async () => {
  await withDataRoot("toonflow-replacement-route-", async () => {
    const runtime = await openDatabase();
    await runtime.work(async (db) => {
      await db("o_project").insert({ id: 7, name: "秦末项目" });
      await db("o_script").insert({
        id: 1,
        name: "第一章",
        content: "章台宫内，胡亥面对奏牍。",
        projectId: 7,
        extractState: 0,
      });
    });

    const app = createApp(extractAssetsRoute);
    const response = await postJson(app, { scriptIds: [1], projectId: 7 });
    assert.equal(response.status, 409);
    assert.equal(response.body.error, "extractionInProgress");
    const rows = await runtime.work((db) => db("o_script").where("id", 1).select("extractState"));
    assert.equal(rows[0].extractState, 0, "进行中的状态不被覆盖");
  });
});

test("路由保持薄适配器：不直接编排模型或删除路由", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "routes", "script", "extractAssets.ts"), "utf8");
  assert.equal(source.includes("getDefaultConfiguredVendor"), false, "路由不得直接编排 Text Model");
  assert.equal(source.includes("delAssets"), false, "不得串联删除路由模拟事务");
  assert.ok(source.includes("claimScriptAssetExtraction"), "路由只做确认占用与委托");
});
