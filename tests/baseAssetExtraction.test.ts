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
import { executeScriptAssetExtraction, type ScriptAssetExtractionDependencies } from "../src/script/assetExtractionReplacement";
import {
  ASSET_IDENTITY_SCHEMA_VERSION,
  createDefaultBaseAssetSkillFileLoader,
  mergeBaseAssetCandidates,
  parseBaseAssetIdentityRecord,
  persistBaseAssetExtraction,
  runBaseAssetExtraction,
  type BaseAssetExtractionDependencies,
  type BaseAssetModelCall,
  type BaseAssetTextCall,
  type StagedBaseAsset,
} from "../src/script/baseAssetExtraction";

const SCRIPT_1 = [
  "章台宫内，年轻的秦二世胡亥面对堆叠奏牍，身居帝位却在赵高逼视下反复迟疑。",
  "赵高立于阶下，垂目不语，殿中只有烛火声。",
  "胡亥开口：“朕已依师之言，尽诛大臣。”",
].join("\n");

const SCRIPT_2 = [
  "大泽乡戍卒营地，连日暴雨。吴广与同伴检查误期名册木牍，粗麻短褐被雨水浸透。",
  "陈胜对众人说：“今亡亦死，举大计亦死。”",
  "营地中的起义戍卒齐声应和，普通围观村民四散躲雨。",
  "雨夜里，两名戍卒举着火把走向大泽乡亭舍。",
].join("\n");

interface ScriptRow {
  id: number;
  name: string;
  content: string;
  projectId: number;
}

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

interface FakeResultTool {
  execute?: (raw: unknown, options: unknown) => Promise<unknown>;
}

function fakeTextCall(
  extractionOutput: () => unknown,
  auditOutput: () => unknown,
  counters: { opened: number; invoked: number } = { opened: 0, invoked: 0 },
): () => Promise<BaseAssetTextCall> {
  return async () => {
    counters.opened += 1;
    let invokedInCall = 0;
    return {
      invoke: async (input: BaseAssetModelCall) => {
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
  cleanup: () => Promise<void>;
}

async function createHarness(): Promise<Harness> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-base-asset-extraction-"));
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
    { id: 1, name: "第一章 章台宫", content: SCRIPT_1, projectId: 7, extractState: 2, createTime: 1 },
    { id: 2, name: "第二章 大泽乡", content: SCRIPT_2, projectId: 7, extractState: 2, createTime: 2 },
  ]);
  const work = workOf(knex);
  const logs: Record<string, unknown>[] = [];
  const base: ScriptAssetExtractionDependencies = {
    work,
    openTextCall: fakeTextCall(
      () => ({ assets: [] }),
      () => ({ additions: [], factAdditions: [], typeCorrections: [], aliasProposals: [] }),
    ),
    loadSkillFile: createDefaultBaseAssetSkillFileLoader(),
    now: () => 1700000000000,
    log: (entry) => logs.push(entry),
    deleteMediaFile: async () => {},
  };
  return {
    deps: (overrides) => ({ ...base, ...overrides }),
    knex,
    cleanup: async () => {
      await knex.destroy();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function fullExtractionOutput() {
  return {
    assets: [
      candidate({ type: "role", canonicalName: "胡亥", aliases: ["二世皇帝"], scriptIds: [1] }),
      candidate({ type: "role", canonicalName: "赵高", scriptIds: [1] }),
      candidate({
        type: "scene",
        canonicalName: "章台宫",
        scriptIds: [1],
        summary: "秦二世处理奏牍的宫殿前殿。",
      }),
      candidate({
        type: "role",
        canonicalName: "吴广",
        aliases: ["吴叔"],
        scriptIds: [2],
        evidence: [{ scriptId: 2, excerpt: "吴广与同伴检查误期名册木牍", locator: "第1场" }],
      }),
      candidate({
        type: "role",
        canonicalName: "陈胜",
        scriptIds: [2],
        evidence: [{ scriptId: 2, excerpt: "陈胜对众人说：“今亡亦死，举大计亦死。”", locator: "第2场" }],
      }),
      candidate({
        type: "scene",
        canonicalName: "大泽乡",
        scriptIds: [2],
        summary: "戍卒驻扎的乡野营地与亭舍。",
        evidence: [{ scriptId: 2, excerpt: "大泽乡戍卒营地，连日暴雨。", locator: "第1场" }],
      }),
      candidate({
        type: "scene",
        canonicalName: "大泽乡·雨夜",
        scriptIds: [2],
        summary: "暴雨之夜的大泽乡。",
        evidence: [{ scriptId: 2, excerpt: "雨夜里，两名戍卒举着火把走向大泽乡亭舍。", locator: "第4场" }],
      }),
      candidate({
        type: "tool",
        canonicalName: "误期名册木牍",
        scriptIds: [2],
        summary: "记录戍卒姓名与到期日期的官府木牍。",
        evidence: [{ scriptId: 2, excerpt: "吴广与同伴检查误期名册木牍", locator: "第1场" }],
      }),
      candidate({
        type: "role",
        canonicalName: "起义戍卒",
        scriptIds: [2],
        summary: "反复出现、统一举义的戍卒群体。",
        evidence: [{ scriptId: 2, excerpt: "营地中的起义戍卒齐声应和", locator: "第3场" }],
      }),
    ],
  };
}

function fullAuditOutput() {
  return {
    additions: [
      candidate({
        type: "role",
        canonicalName: "王二",
        scriptIds: [2],
        summary: "雨夜举火把的老戍卒。",
        evidence: [{ scriptId: 2, excerpt: "两名戍卒举着火把走向大泽乡亭舍。", locator: "第4场" }],
      }),
    ],
    factAdditions: [
      {
        type: "role",
        canonicalName: "胡亥",
        identityFacts: { gender: "男", ageBand: "青年" },
        evidence: [{ scriptId: 1, excerpt: "年轻的秦二世胡亥", locator: "第1场" }],
      },
    ],
    typeCorrections: [],
    aliasProposals: [
      {
        type: "role",
        canonicalName: "陈胜",
        alias: "陈王",
        evidence: [{ scriptId: 2, excerpt: "陈胜对众人说：“今亡亦死，举大计亦死。”", locator: "第2场" }],
      },
    ],
  };
}

test("固定 fake 模型响应下重复运行得到相同的确定性结果", async () => {
  const harness = await createHarness();
  try {
    const deps = harness.deps({
      openTextCall: fakeTextCall(fullExtractionOutput, fullAuditOutput),
    });
    const first = await runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [2, 1] });
    const second = await runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] });
    assert.deepEqual(first, second);
  } finally {
    await harness.cleanup();
  }
});

test("主提取返回完整候选：边缘人物、参考道具与群体资产都在 staged 结果中", async () => {
  const harness = await createHarness();
  try {
    const deps = harness.deps({
      openTextCall: fakeTextCall(fullExtractionOutput, fullAuditOutput),
    });
    const staged = await runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] });
    const names = staged.candidates.map((c) => c.canonicalName);
    for (const expected of ["胡亥", "赵高", "吴广", "陈胜", "王二", "误期名册木牍", "起义戍卒"]) {
      assert.ok(names.includes(expected), `缺少资产 ${expected}`);
    }
    // 胡亥、吴广必须保持独立身份
    const hu = staged.candidates.find((c) => c.canonicalName === "胡亥");
    const wu = staged.candidates.find((c) => c.canonicalName === "吴广");
    assert.ok(hu && wu);
    assert.equal(hu.type, "role");
    assert.equal(wu.type, "role");
    // 胡亥获得审计补充的类型专属身份事实
    assert.deepEqual(hu.identityFacts, { gender: "男", ageBand: "青年" });
    // 陈胜获得有证据的别名
    assert.ok(staged.candidates.find((c) => c.canonicalName === "陈胜")!.aliases.includes("陈王"));
  } finally {
    await harness.cleanup();
  }
});

test("大泽乡是 Base Scene，大泽乡·雨夜被折叠为同一 Base Scene", async () => {
  const harness = await createHarness();
  try {
    const deps = harness.deps({
      openTextCall: fakeTextCall(fullExtractionOutput, fullAuditOutput),
    });
    const staged = await runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] });
    const scenes = staged.candidates.filter((c) => c.type === "scene");
    assert.deepEqual(
      scenes.map((c) => c.canonicalName),
      ["大泽乡", "章台宫"],
    );
    const daze = scenes.find((c) => c.canonicalName === "大泽乡")!;
    // 雨夜证据被合并进基础场景，而不是产生 Derived Asset
    assert.ok(daze.evidence.some((e) => e.excerpt.includes("火把")));
  } finally {
    await harness.cleanup();
  }
});

test("同名不同身份保持两个候选并只在后端记录 identityAmbiguous", async () => {
  const harness = await createHarness();
  try {
    const logs: Record<string, unknown>[] = [];
    const output = () => ({
      assets: [
        candidate({ type: "role", canonicalName: "李信", scriptIds: [1] }),
        candidate({
          type: "role",
          canonicalName: "李信",
          scriptIds: [2],
          summary: "与大泽乡李信同名的另一名戍卒。",
          evidence: [{ scriptId: 2, excerpt: "营地中的起义戍卒齐声应和", locator: "第3场" }],
        }),
      ],
    });
    const deps = harness.deps({
      openTextCall: fakeTextCall(output, () => ({ additions: [], factAdditions: [], typeCorrections: [], aliasProposals: [] })),
      log: (entry) => logs.push(entry),
    });
    const staged = await runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] });
    const same = staged.candidates.filter((c) => c.canonicalName === "李信");
    assert.equal(same.length, 2, "同名不同身份保持两个候选");
    assert.ok(
      staged.candidates.every((c) => !("identityAmbiguous" in c)),
      "staged 结果不携带 identityAmbiguous 字段",
    );
    assert.ok(logs.some((entry) => entry.kind === "identityAmbiguous"));
  } finally {
    await harness.cleanup();
  }
});

test("全名、简称、称号别名合并为同一候选", async () => {
  const harness = await createHarness();
  try {
    const output = () => ({
      assets: [
        candidate({ type: "role", canonicalName: "刘邦", aliases: ["汉王"], scriptIds: [1] }),
        candidate({
          type: "role",
          canonicalName: "沛公",
          aliases: ["刘邦"],
          scriptIds: [2],
          summary: "起兵前的刘邦。",
          evidence: [{ scriptId: 2, excerpt: "雨夜里，两名戍卒举着火把", locator: "第4场" }],
        }),
      ],
    });
    const deps = harness.deps({
      openTextCall: fakeTextCall(output, () => ({ additions: [], factAdditions: [], typeCorrections: [], aliasProposals: [] })),
    });
    const staged = await runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] });
    const names = staged.candidates.map((c) => c.canonicalName);
    assert.deepEqual(names, ["刘邦"]);
    const liu = staged.candidates[0];
    assert.ok(liu.aliases.includes("沛公"));
    assert.deepEqual(liu.scriptIds, [1, 2]);
  } finally {
    await harness.cleanup();
  }
});

test("模型输出校验：缺少证据、未知 scriptId、类型错误、非法工具输出均使运行失败", async () => {
  const harness = await createHarness();
  try {
    const cases: { name: string; payload: () => unknown }[] = [
      {
        name: "缺少证据",
        payload: () => ({
          assets: [{ ...candidate({ canonicalName: "无证据者" }), evidence: [], scriptIds: [] }],
        }),
      },
      {
        name: "未知 scriptId",
        payload: () => ({
          assets: [candidate({ canonicalName: "越界者", scriptIds: [99], evidence: [{ scriptId: 99, excerpt: "x", locator: "第1场" }] })],
        }),
      },
      {
        name: "类型错误",
        payload: () => ({
          assets: [{ ...candidate({ canonicalName: "错误类型" }), type: "location" as unknown as BaseAssetCandidate["type"] }],
        }),
      },
      {
        name: "非法工具输出",
        payload: () => ({ assets: "不是数组" }),
      },
    ];
    for (const testCase of cases) {
      const deps = harness.deps({
        openTextCall: fakeTextCall(testCase.payload, () => ({ additions: [], factAdditions: [], typeCorrections: [], aliasProposals: [] })),
      });
      await assert.rejects(
        runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] }),
        Error,
        `用例 ${testCase.name} 应失败`,
      );
    }
  } finally {
    await harness.cleanup();
  }
});

test("审计可以补充遗漏资产但不能删除主结果候选", async () => {
  const harness = await createHarness();
  try {
    const deps = harness.deps({
      openTextCall: fakeTextCall(
        fullExtractionOutput,
        () => ({
          additions: [],
          factAdditions: [],
          typeCorrections: [],
          aliasProposals: [],
          // 模型尝试输出删除指令：契约层面不存在该操作
          removals: [{ canonicalName: "赵高" }],
        }),
      ),
    });
    const staged = await runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] });
    assert.ok(staged.candidates.some((c) => c.canonicalName === "赵高"), "审计不得删除已有证据的候选");
  } finally {
    await harness.cleanup();
  }
});

test("两次模型调用复用任务开始时解析出的同一个 Text Model 目标", async () => {
  const harness = await createHarness();
  try {
    const counters = { opened: 0, invoked: 0 };
    const deps = harness.deps({
      openTextCall: fakeTextCall(fullExtractionOutput, fullAuditOutput, counters),
    });
    await runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] });
    assert.equal(counters.opened, 1, "目标只解析一次");
    assert.equal(counters.invoked, 2, "恰好两次模型调用");
  } finally {
    await harness.cleanup();
  }
});

test("任一模型调用失败不产生部分写入，剧本状态回写失败原因", async () => {
  const harness = await createHarness();
  try {
    const counters = { opened: 0, invoked: 0 };
    const deps = harness.deps({
      openTextCall: fakeTextCall(fullExtractionOutput, () => {
        throw new Error("审计调用网络失败");
      }, counters),
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] });
    assert.equal(outcome.ok, false);
    const states = await harness.knex("o_script").whereIn("id", [1, 2]).select("id", "extractState", "errorReason");
    for (const row of states) {
      assert.equal(row.extractState, -1);
      assert.ok(row.errorReason);
    }
    const assets = await harness.knex("o_assets").where("projectId", 7);
    assert.equal(assets.length, 0, "失败不写入任何资产");
    const links = await harness.knex("o_scriptAssets");
    assert.equal(links.length, 0, "失败不写入任何剧本-资产关联");
    const identities = await harness.knex("o_assetIdentity");
    assert.equal(identities.length, 0, "失败不写入任何身份记录");
  } finally {
    await harness.cleanup();
  }
});

test("execute 成功路径：一次性写入资产、身份记录与关联，剧本状态置为成功", async () => {
  const harness = await createHarness();
  try {
    const deps = harness.deps({
      openTextCall: fakeTextCall(fullExtractionOutput, fullAuditOutput),
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] });
    assert.equal(outcome.ok, true);

    const assets = await harness.knex("o_assets").where("projectId", 7);
    assert.equal(assets.length, 9);
    const huRow = assets.find((a) => a.name === "胡亥")!;
    assert.equal(huRow.type, "role");
    assert.ok(huRow.describe!.includes("【角色】胡亥"), "describe 是确定性编译摘要");
    assert.ok(huRow.describe!.includes("二世皇帝"), "摘要包含别名");

    const identityRow = await harness.knex("o_assetIdentity").where("assetsId", huRow.id).first();
    assert.ok(identityRow, "每个 Base Asset 拥有独立的结构化身份记录");
    assert.equal(identityRow.schemaVersion, ASSET_IDENTITY_SCHEMA_VERSION);
    const record = parseBaseAssetIdentityRecord(identityRow.identity);
    assert.equal(record.canonicalName, "胡亥");
    assert.deepEqual(record.aliases, ["二世皇帝"]);
    assert.deepEqual(record.identityFacts, { gender: "男", ageBand: "青年" });
    assert.ok(record.baseline, "身份记录携带首次明确可视出场基准");
    assert.equal(record.baseline!.scriptId, 1);

    const links = await harness.knex("o_scriptAssets");
    assert.ok(links.length > 0);
    const huLinks = links.filter((l) => l.assetId === huRow.id);
    assert.deepEqual(huLinks.map((l) => l.scriptId), [1]);

    const states = await harness.knex("o_script").whereIn("id", [1, 2]).select("extractState", "errorReason");
    for (const row of states) {
      assert.equal(row.extractState, 1);
      assert.equal(row.errorReason, null);
    }
  } finally {
    await harness.cleanup();
  }
});

test("重复持久化复用已存在的资产并重建关联，不产生重复身份", async () => {
  const harness = await createHarness();
  try {
    const deps = harness.deps({
      openTextCall: fakeTextCall(fullExtractionOutput, fullAuditOutput),
    });
    const staged = await runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] });
    await persistBaseAssetExtraction(deps, staged);
    await persistBaseAssetExtraction(deps, staged);

    const assets = await harness.knex("o_assets").where("projectId", 7);
    assert.equal(assets.length, 9, "重复持久化不产生重复资产");
    const identities = await harness.knex("o_assetIdentity");
    assert.equal(identities.length, 9, "每个资产只有一条当前态身份记录");
    const links = await harness.knex("o_scriptAssets");
    const uniquePairs = new Set(links.map((l) => `${l.scriptId}_${l.assetId}`));
    assert.equal(links.length, uniquePairs.size, "关联不重复");
  } finally {
    await harness.cleanup();
  }
});

test("同名不同身份持久化为两个独立资产，身份记录不互相覆盖", async () => {
  const harness = await createHarness();
  try {
    const output = () => ({
      assets: [
        candidate({ type: "role", canonicalName: "李信", scriptIds: [1] }),
        candidate({
          type: "role",
          canonicalName: "李信",
          scriptIds: [2],
          summary: "与大泽乡李信同名的另一名戍卒。",
          evidence: [{ scriptId: 2, excerpt: "营地中的起义戍卒齐声应和", locator: "第3场" }],
        }),
      ],
    });
    const deps = harness.deps({
      openTextCall: fakeTextCall(output, () => ({ additions: [], factAdditions: [], typeCorrections: [], aliasProposals: [] })),
    });
    const staged = await runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] });
    assert.equal(staged.candidates.length, 2);
    await persistBaseAssetExtraction(deps, staged);
    await persistBaseAssetExtraction(deps, staged);

    const assets = await harness.knex("o_assets").where("projectId", 7).orderBy("id");
    assert.equal(assets.length, 2, "同名不同身份持久化为两个资产");
    const identities = await harness.knex("o_assetIdentity").orderBy("id");
    assert.equal(identities.length, 2, "两个资产各有一条身份记录");
    const records = identities.map((row) => parseBaseAssetIdentityRecord(row.identity));
    assert.deepEqual(
      records.map((record) => record.baseline.scriptId).sort(),
      [1, 2],
      "两条身份记录保留各自的剧本归属，未被覆盖",
    );
  } finally {
    await harness.cleanup();
  }
});

test("重复或冲突的审计操作被确定性拒绝", async () => {
  const harness = await createHarness();
  try {
    const factEvidence = [{ scriptId: 1, excerpt: "年轻的秦二世胡亥", locator: "第1场" }];
    const cases: { name: string; audit: () => unknown }[] = [
      {
        name: "重复事实补充",
        audit: () => ({
          additions: [],
          factAdditions: [
            { type: "role", canonicalName: "胡亥", identityFacts: { gender: "男" }, evidence: factEvidence },
            { type: "role", canonicalName: "胡亥", identityFacts: { ageBand: "青年" }, evidence: factEvidence },
          ],
          typeCorrections: [],
          aliasProposals: [],
        }),
      },
      {
        name: "类型修正与事实补充冲突",
        audit: () => ({
          additions: [],
          factAdditions: [
            { type: "role", canonicalName: "胡亥", identityFacts: { gender: "男" }, evidence: factEvidence },
          ],
          typeCorrections: [
            { type: "role", canonicalName: "胡亥", newType: "scene", evidence: factEvidence },
          ],
          aliasProposals: [],
        }),
      },
      {
        name: "重复类型修正",
        audit: () => ({
          additions: [],
          factAdditions: [],
          typeCorrections: [
            { type: "scene", canonicalName: "章台宫", newType: "role", evidence: factEvidence },
            { type: "scene", canonicalName: "章台宫", newType: "tool", evidence: factEvidence },
          ],
          aliasProposals: [],
        }),
      },
    ];
    for (const testCase of cases) {
      const deps = harness.deps({
        openTextCall: fakeTextCall(fullExtractionOutput, testCase.audit),
      });
      await assert.rejects(
        runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] }),
        /重复|冲突/,
        `用例 ${testCase.name} 应被拒绝`,
      );
    }
  } finally {
    await harness.cleanup();
  }
});

test("审计不得用不同值静默覆盖已有身份事实", () => {
  assert.throws(
    () =>
      mergeBaseAssetCandidates(
        [candidate({ canonicalName: "胡亥", identityFacts: { gender: "男" } })],
        {
          additions: [],
          factAdditions: [
            {
              type: "role",
              canonicalName: "胡亥",
              identityFacts: { gender: "女" },
              evidence: [{ scriptId: 1, excerpt: "年轻的秦二世胡亥", locator: "第1场" }],
            },
          ],
          typeCorrections: [],
          aliasProposals: [],
        },
        { log: () => undefined },
      ),
    /事实补充与已有事实冲突/,
  );
});

test("提取进行中的剧本拒绝重入请求", async () => {
  const harness = await createHarness();
  try {
    await harness.knex("o_script").where("id", 1).update({ extractState: 0 });
    const deps = harness.deps({
      openTextCall: fakeTextCall(fullExtractionOutput, fullAuditOutput),
    });
    const outcome = await executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "extractionInProgress");
    const states = await harness.knex("o_script").whereIn("id", [1, 2]).select("id", "extractState");
    assert.equal(states.find((s) => s.id === 1)!.extractState, 0, "进行中的剧本状态不被覆盖");
    assert.notEqual(states.find((s) => s.id === 2)!.extractState, 1, "重入请求不产生任何写入");
  } finally {
    await harness.cleanup();
  }
});

test("分批提取的同名候选没有证据或别名关联时不得复用旧资产", async () => {
  const harness = await createHarness();
  try {
    const emptyAudit = () => ({ additions: [], factAdditions: [], typeCorrections: [], aliasProposals: [] });
    const firstDeps = harness.deps({
      openTextCall: fakeTextCall(
        () => ({ assets: [candidate({ canonicalName: "李信", scriptIds: [1] })] }),
        emptyAudit,
      ),
    });
    const secondDeps = harness.deps({
      openTextCall: fakeTextCall(
        () => ({ assets: [candidate({ canonicalName: "李信", scriptIds: [2] })] }),
        emptyAudit,
      ),
    });
    await persistBaseAssetExtraction(firstDeps, await runBaseAssetExtraction(firstDeps, { projectId: 7, scriptIds: [1] }));
    await persistBaseAssetExtraction(secondDeps, await runBaseAssetExtraction(secondDeps, { projectId: 7, scriptIds: [2] }));

    assert.equal((await harness.knex("o_assets").where({ projectId: 7, name: "李信" })).length, 2);
  } finally {
    await harness.cleanup();
  }
});

test("共享资产跨剧本具有一致身份事实时复用既有资产", async () => {
  const harness = await createHarness();
  try {
    const emptyAudit = () => ({ additions: [], factAdditions: [], typeCorrections: [], aliasProposals: [] });
    const firstDeps = harness.deps({
      openTextCall: fakeTextCall(
        () => ({ assets: [candidate({ canonicalName: "胡亥", scriptIds: [1], identityFacts: { occupation: "秦二世" } })] }),
        emptyAudit,
      ),
    });
    const secondDeps = harness.deps({
      openTextCall: fakeTextCall(
        () => ({ assets: [candidate({ canonicalName: "胡亥", scriptIds: [2], identityFacts: { occupation: "秦二世" } })] }),
        emptyAudit,
      ),
    });
    await persistBaseAssetExtraction(firstDeps, await runBaseAssetExtraction(firstDeps, { projectId: 7, scriptIds: [1] }));
    await persistBaseAssetExtraction(secondDeps, await runBaseAssetExtraction(secondDeps, { projectId: 7, scriptIds: [2] }));

    assert.equal((await harness.knex("o_assets").where({ projectId: 7, name: "胡亥" })).length, 1);
  } finally {
    await harness.cleanup();
  }
});

test("不同规范名仅共享通用称号时不得合并身份", async () => {
  const harness = await createHarness();
  try {
    const emptyAudit = () => ({ additions: [], factAdditions: [], typeCorrections: [], aliasProposals: [] });
    const firstDeps = harness.deps({
      openTextCall: fakeTextCall(
        () => ({ assets: [candidate({ canonicalName: "甲将军", aliases: ["将军"], scriptIds: [1] })] }),
        emptyAudit,
      ),
    });
    const secondDeps = harness.deps({
      openTextCall: fakeTextCall(
        () => ({ assets: [candidate({ canonicalName: "乙将军", aliases: ["将军"], scriptIds: [2] })] }),
        emptyAudit,
      ),
    });
    await persistBaseAssetExtraction(firstDeps, await runBaseAssetExtraction(firstDeps, { projectId: 7, scriptIds: [1] }));
    await persistBaseAssetExtraction(secondDeps, await runBaseAssetExtraction(secondDeps, { projectId: 7, scriptIds: [2] }));

    assert.equal((await harness.knex("o_assets").where("projectId", 7)).length, 2);
  } finally {
    await harness.cleanup();
  }
});

test("两个同时开始的提取请求只能有一个原子占用剧本", async () => {
  const harness = await createHarness();
  try {
    let workCalls = 0;
    let releaseChecks!: () => void;
    const bothChecksFinished = new Promise<void>((resolve) => {
      releaseChecks = resolve;
    });
    let waitingChecks = 0;
    const racingWork: BaseAssetExtractionDependencies["work"] = async (operation) => {
      const call = ++workCalls;
      const result = await operation(harness.knex);
      // 旧实现的第 3/4 次 work 分别是两个请求的“先查后写”重入检查。
      // 把两次读取都停在写入之前，可稳定复现两个请求同时通过检查的竞态。
      if (call === 3 || call === 4) {
        waitingChecks += 1;
        if (waitingChecks === 2) releaseChecks();
        await bothChecksFinished;
      }
      return result;
    };
    const counters = { opened: 0, invoked: 0 };
    const deps = harness.deps({
      work: racingWork,
      openTextCall: fakeTextCall(fullExtractionOutput, fullAuditOutput, counters),
    });

    const outcomes = await Promise.all([
      executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] }),
      executeScriptAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] }),
    ]);

    assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.error === "extractionInProgress").length, 1);
    assert.equal(counters.opened, 1, "被拒绝的并发请求不得打开 Text Model 调用");
    assert.equal(counters.invoked, 2, "获胜请求只执行基础提取与完整性审计两次调用");
  } finally {
    await harness.cleanup();
  }
});

test("mergeBaseAssetCandidates：审计修正类型并拒绝指向不存在候选的操作", async () => {
  const candidates = [
    candidate({ type: "role", canonicalName: "项梁", scriptIds: [1] }),
    candidate({ type: "tool", canonicalName: "楚军大旗", scriptIds: [1] }),
  ];
  const merged = mergeBaseAssetCandidates(
    candidates,
    {
      additions: [],
      factAdditions: [],
      typeCorrections: [
        {
          type: "tool",
          canonicalName: "楚军大旗",
          newType: "scene" as const,
          evidence: [{ scriptId: 1, excerpt: "楚军大旗立于辕门。", locator: "第1场" }],
        },
      ],
      aliasProposals: [],
    },
    { log: () => undefined },
  );
  assert.equal(merged.find((c) => c.canonicalName === "楚军大旗")!.type, "scene");

  assert.throws(() =>
    mergeBaseAssetCandidates(
      candidates,
      {
        additions: [],
        factAdditions: [],
        typeCorrections: [
          {
            type: "role",
            canonicalName: "不存在的候选",
            newType: "scene" as const,
            evidence: [{ scriptId: 1, excerpt: "x", locator: "第1场" }],
          },
        ],
        aliasProposals: [],
      },
      { log: () => undefined },
    ),
    /不存在/,
  );
});

test("审计补充的别名如果撞上另一个候选的规范名，保持两个候选并记录 identityAmbiguous", async () => {
  const logs: Record<string, unknown>[] = [];
  const candidates = [
    candidate({ type: "role", canonicalName: "陈胜", scriptIds: [2] }),
    candidate({ type: "role", canonicalName: "张楚王", scriptIds: [2] }),
  ];
  const merged = mergeBaseAssetCandidates(
    candidates,
    {
      additions: [],
      factAdditions: [],
      typeCorrections: [],
      aliasProposals: [
        {
          type: "role",
          canonicalName: "陈胜",
          alias: "张楚王",
          evidence: [{ scriptId: 2, excerpt: "陈胜称张楚王。", locator: "第3场" }],
        },
      ],
    },
    { log: (entry) => logs.push(entry) },
  );
  assert.equal(merged.filter((c) => c.canonicalName === "陈胜" || c.canonicalName === "张楚王").length, 2);
  assert.ok(logs.some((entry) => entry.kind === "identityAmbiguous"));
});

test("技能模板文件存在且不包含主观提取标准", async () => {
  const loader = createDefaultBaseAssetSkillFileLoader();
  const extractionPrompt = await loader("prompts/base_asset_extraction.md");
  const auditPrompt = await loader("prompts/base_asset_completeness_review.md");
  assert.ok(extractionPrompt && extractionPrompt.trim().length > 0, "基础提取模板必须存在");
  assert.ok(auditPrompt && auditPrompt.trim().length > 0, "完整性审计模板必须存在");
  for (const prompt of [extractionPrompt, auditPrompt]) {
    assert.equal(prompt.includes("核心"), false, "提示词不得包含主观的“核心”标准");
    assert.equal(prompt.includes("重要"), false, "提示词不得包含主观的“重要”标准");
    assert.equal(prompt.includes("assetsList"), false, "提示词不得引用旧 assetsList 字段");
    assert.equal(prompt.includes("prompt/assetsList"), false);
  }
  assert.ok(extractionPrompt.includes("群体"), "基础提取模板必须写明群体收录边界");
  assert.ok(auditPrompt.includes("不得删除"), "审计模板必须写明不可删除边界");
});

test("生产适配器限制每个阶段最多一次模型 step", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "script", "baseAssetExtraction.ts"), "utf8");
  assert.ok(source.includes("stopWhen: stepCountIs(1)"));
});

test("模型证据摘录必须确实存在于对应剧本原文", async () => {
  const harness = await createHarness();
  try {
    const deps = harness.deps({
      openTextCall: fakeTextCall(
        () => ({
          assets: [
            candidate({
              canonicalName: "伪证据候选",
              evidence: [{ scriptId: 1, excerpt: "剧本中不存在的伪造证据", locator: "第1场" }],
            }),
          ],
        }),
        () => ({ additions: [], factAdditions: [], typeCorrections: [], aliasProposals: [] }),
      ),
    });
    await assert.rejects(
      runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1] }),
      /证据摘录不存在于剧本 1 原文中/,
    );
  } finally {
    await harness.cleanup();
  }
});

test("路由不再拥有 Text Model 编排或分片规则", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "routes", "script", "extractAssets.ts"), "utf8");
  assert.equal(source.includes("groupSize"), false, "路由不得再接收 groupSize");
  assert.equal(source.includes("getDefaultConfiguredVendor"), false, "路由不得直接编排 Text Model");
  assert.equal(source.includes("chunkArray"), false, "路由不得再包含分片逻辑");
  assert.equal(source.includes("invokeText"), false, "路由不得直接调用 Text Model");
});

test("运行时不存在的剧本被跳过，存在的剧本继续完成提取", async () => {
  const harness = await createHarness();
  try {
    const deps = harness.deps({
      openTextCall: fakeTextCall(
        () => ({
          assets: [
            candidate({ type: "role", canonicalName: "胡亥", aliases: ["二世皇帝"], scriptIds: [1] }),
            candidate({ type: "scene", canonicalName: "章台宫", scriptIds: [1] }),
          ],
        }),
        () => ({ additions: [], factAdditions: [], typeCorrections: [], aliasProposals: [] }),
      ),
    });
    const staged = await runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1, 999] });
    assert.deepEqual(staged.scriptIds, [1]);
    assert.equal(staged.candidates.length, 2);
  } finally {
    await harness.cleanup();
  }
});

test("模型未调用工具返回结果时运行失败", async () => {
  const harness = await createHarness();
  try {
    const deps = harness.deps({
      openTextCall: async () => ({
        invoke: async () => {
          /* 模型没有调用 resultTool */
        },
      }),
    });
    await assert.rejects(runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1] }));
  } finally {
    await harness.cleanup();
  }
});

test("审计输出引用未知剧本 ID 时运行失败", async () => {
  const harness = await createHarness();
  try {
    const deps = harness.deps({
      openTextCall: fakeTextCall(
        fullExtractionOutput,
        () => ({
          additions: [
            candidate({ canonicalName: "越界补充", scriptIds: [88], evidence: [{ scriptId: 88, excerpt: "x", locator: "第1场" }] }),
          ],
          factAdditions: [],
          typeCorrections: [],
          aliasProposals: [],
        }),
      ),
    });
    await assert.rejects(runBaseAssetExtraction(deps, { projectId: 7, scriptIds: [1, 2] }));
  } finally {
    await harness.cleanup();
  }
});

test("staged 候选按类型与名称确定性排序，describe 可确定性编译", () => {
  const merged = mergeBaseAssetCandidates(
    [
      candidate({ type: "tool", canonicalName: "误期名册木牍", scriptIds: [2] }),
      candidate({ type: "scene", canonicalName: "大泽乡", scriptIds: [2] }),
      candidate({ type: "role", canonicalName: "吴广", aliases: ["吴叔"], scriptIds: [2] }),
    ],
    { additions: [], factAdditions: [], typeCorrections: [], aliasProposals: [] },
    { log: () => undefined },
  );
  assert.deepEqual(
    merged.map((c: StagedBaseAsset) => c.canonicalName),
    ["吴广", "大泽乡", "误期名册木牍"],
  );
  const wu = merged[0] as StagedBaseAsset;
  assert.equal(wu.describe, "【角色】吴广（又称：吴叔）：吴广的剧本内身份摘要。");
});

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

test("路由是薄适配器：立即响应并把提取委托给编排模块", { timeout: 120000 }, async () => {
  await withDataRoot("toonflow-base-asset-route-", async () => {
    const runtime = await openDatabase();
    await runtime.work(async (db) => {
      await db("o_project").insert({ id: 7, name: "秦末项目" });
      await db("o_script").insert({
        id: 1,
        name: "第一章",
        content: "章台宫内，胡亥面对奏牍。",
        projectId: 7,
        extractState: 2,
      });
    });

    const app = createApp(extractAssetsRoute);
    const { status, body } = await postJson(app, { scriptIds: [1], projectId: 7 });
    assert.equal(status, 200);
    assert.equal(body.data, "开始提取资产");

    // 未配置 Text Model 时后台执行最终落为失败状态，证明路由确实委托了编排模块。
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const rows = await runtime.work((db) => db("o_script").where("id", 1).select("extractState"));
      if (rows[0].extractState !== 0) {
        assert.equal(rows[0].extractState, -1);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail("提取状态未在合理时间内落定");
  });
});
