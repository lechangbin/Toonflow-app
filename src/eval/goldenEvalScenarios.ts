import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import knexFactory, { type Knex } from "knex";

import { compileAssetGenerationPrompt, AGNES_IMAGE_2_1_FLASH_PROFILE } from "../assets/assetPromptCompiler";
import type { AssetBrief, AssetReferenceBinding } from "../assets/assetBriefContract";
import {
  generateAssetImage,
  type AssetImageGenerationDependencies,
} from "../assets/assetImageGeneration";
import { compileDerivedAssetPrompt, resolveDerivedAssetGenerationEntry } from "../assets/derivedAssetPrompt";
import {
  cancelImageGeneration,
  failInterruptedImageGenerations,
  readImageGenerationPollingRows,
  sanitizeDiagnosticText,
  sanitizeVendorImageFailureDiagnostics,
  VendorImageGenerationError,
} from "../assets/imageGenerationLifecycle";
import { createAssetReference, type AssetReferenceRecord } from "../assets/assetReferences";
import type { ResolvedAssetGenerationInput } from "../assets/assetPromptOrchestration";
import type { DatabaseWork } from "../database";
import initDB from "../lib/initDB";
import type { BaseAssetCandidate } from "../script/assetExtractionContract";
import {
  BaseAssetExtractionFailure,
  createDefaultBaseAssetSkillFileLoader,
  mergeBaseAssetCandidates,
  runBaseAssetExtraction,
  type BaseAssetExtractionDependencies,
  type BaseAssetModelCall,
  type BaseAssetTextCall,
} from "../script/baseAssetExtraction";
import { replaceScriptAssetExtraction, type ScriptAssetExtractionDependencies } from "../script/assetExtractionReplacement";

export interface ScenarioObservation {
  gates: Record<string, boolean>;
  artifacts: Record<string, unknown>;
}

interface ScenarioEnvironment {
  db: Knex;
  work: DatabaseWork;
  model: DeterministicFakeModel;
  vendor: DeterministicFakeVendor;
}

type Scenario = (environment: ScenarioEnvironment) => Promise<ScenarioObservation>;

const SCRIPT_1 = "第1场 章台宫内，年轻的秦二世胡亥面对奏牍。赵高立于阶下。";
const SCRIPT_2 = "第1场 大泽乡戍卒营地，连日暴雨。吴广检查误期名册木牍。第2场 陈胜召集戍卒。";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function candidate(overrides: Partial<BaseAssetCandidate> & { canonicalName: string }): BaseAssetCandidate {
  const scriptId = overrides.scriptIds?.[0] ?? 1;
  return {
    type: "role",
    aliases: [],
    summary: `${overrides.canonicalName}的剧本身份。`,
    scriptIds: [scriptId],
    evidence: [
      {
        scriptId,
        excerpt: scriptId === 1 ? "年轻的秦二世胡亥面对奏牍" : "大泽乡戍卒营地，连日暴雨",
        locator: "第1场",
      },
    ],
    ...overrides,
  };
}

const EMPTY_AUDIT = { additions: [], factAdditions: [], typeCorrections: [], aliasProposals: [] };

class DeterministicFakeModel {
  calls = 0;
  private responseSets: unknown[][] = [];

  queue(...responses: unknown[]): void {
    this.responseSets.push(responses);
  }

  openTextCall = async (): Promise<BaseAssetTextCall> => {
    const responses = this.responseSets.shift() ?? [];
    let index = 0;
    return {
      invoke: async (input: BaseAssetModelCall) => {
        this.calls += 1;
        const resultTool = input.tools.resultTool as {
          execute?: (raw: unknown, options: { toolCallId: string; messages: unknown[] }) => Promise<unknown>;
        };
        if (!resultTool?.execute) throw new Error("Fake Model expected resultTool");
        await resultTool.execute(responses[index++], { toolCallId: `fake-model-${this.calls}`, messages: [] });
      },
    };
  };
}

class DeterministicFakeVendor {
  calls = 0;
  private result: unknown = { kind: "base64", data: "ZmFrZQ==" };

  respondWith(result: unknown): void {
    this.result = result;
  }

  async generateImage(): Promise<unknown> {
    this.calls += 1;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

export async function createGoldenScenarioEnvironment(
  caseId: string,
  initialize: (db: Knex) => Promise<void> = initDB,
): Promise<{ environment: ScenarioEnvironment; cleanup: () => Promise<void> }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `toonflow-golden-${caseId.toLowerCase()}-`));
  const db = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(directory, "case.sqlite") },
    useNullAsDefault: true,
  });
  try {
    await db.raw("PRAGMA foreign_keys = OFF");
    await db.schema.createTable("o_skillList", (table) => table.text("id").primary());
    const originalLog = console.log;
    console.log = () => undefined;
    try {
      await initialize(db);
    } finally {
      console.log = originalLog;
    }
  } catch (error) {
    await db.destroy().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  const environment: ScenarioEnvironment = {
    db,
    work: async <T>(operation: (database: Knex) => Promise<T> | T) => operation(db),
    model: new DeterministicFakeModel(),
    vendor: new DeterministicFakeVendor(),
  };
  return {
    environment,
    cleanup: async () => {
      await db.destroy();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function seedExtraction(environment: ScenarioEnvironment): Promise<BaseAssetExtractionDependencies> {
  await environment.db("o_project").insert({ id: 7, name: "秦末项目", type: "短剧", intro: "Golden Eval" });
  await environment.db("o_script").insert([
    { id: 1, name: "章台宫", content: SCRIPT_1, projectId: 7, extractState: 2, createTime: 1 },
    { id: 2, name: "大泽乡", content: SCRIPT_2, projectId: 7, extractState: 2, createTime: 2 },
  ]);
  return {
    work: environment.work,
    openTextCall: environment.model.openTextCall,
    loadSkillFile: createDefaultBaseAssetSkillFileLoader(),
    now: () => 1_700_000_000_000,
    log: () => undefined,
  };
}

function extractionPayload(): { assets: BaseAssetCandidate[] } {
  return {
    assets: [
      candidate({ canonicalName: "胡亥", scriptIds: [1] }),
      candidate({
        canonicalName: "大泽乡",
        type: "scene",
        scriptIds: [2],
        evidence: [{ scriptId: 2, excerpt: "大泽乡戍卒营地，连日暴雨", locator: "第1场" }],
      }),
    ],
  };
}

function reviewPayload() {
  return {
    ...EMPTY_AUDIT,
    additions: [
      candidate({
        canonicalName: "吴广",
        scriptIds: [2],
        evidence: [{ scriptId: 2, excerpt: "吴广检查误期名册木牍", locator: "第1场" }],
      }),
    ],
  };
}

function loadBriefs(): AssetBrief[] {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), "data/skills/asset-prompting/fixtures/historical-character-contrast.expected.json"),
      "utf8",
    ),
  ) as { assetBriefs: AssetBrief[] };
  return fixture.assetBriefs;
}

function referenceBinding(id: string, priority: number, dimensions: string[]): AssetReferenceBinding {
  return {
    referenceId: id,
    label: `参考图${id}`,
    description: `${id} 人工描述`,
    primaryRole: "identity",
    subjectSelector: "画面中央主体",
    mustPreserve: [`${id}保留项`],
    mustIgnore: ["背景"],
    controlledDimensions: dimensions,
    priority,
    evidenceSource: "manual",
  } as AssetReferenceBinding;
}

function fixtureGenerationInput(assetsId = 101): ResolvedAssetGenerationInput {
  return {
    assetsId,
    assetRawType: "role",
    briefType: "character",
    name: "胡亥",
    generationPrompt: "秦末年轻皇帝角色设定图",
    promptRevision: {
      skillVersion: "golden-fixture@1.0.0",
      templateHash: "a".repeat(64),
      contextHash: "b".repeat(64),
      referenceHash: "c".repeat(64),
    },
    references: [],
    selectedReferenceIds: [],
  };
}

function imageDependencies(
  environment: ScenarioEnvironment,
  generate: AssetImageGenerationDependencies["generateImage"],
  evidence: { mediaWrites: number; taskStates: Array<{ state: 1 | -1; reason?: string }> },
): AssetImageGenerationDependencies {
  return {
    work: environment.work,
    resolveGenerationInputs: async () => ({ ok: true, value: [fixtureGenerationInput()] }),
    readReferenceMedia: async () => {
      throw new Error("Golden fixture has no Asset References");
    },
    generateImage: generate,
    recordGenerationTask: async () => async (state, reason) => {
      evidence.taskStates.push({ state, ...(reason ? { reason } : {}) });
    },
    writeGeneratedImage: async () => {
      evidence.mediaWrites += 1;
    },
    getImageUrl: async () => "/fake/generated.jpg",
  };
}

const scenarios: Record<string, Scenario> = {
  "extraction-two-stage": async (environment) => {
    const dependencies = await seedExtraction(environment);
    environment.model.queue(extractionPayload(), reviewPayload());
    const staged = await runBaseAssetExtraction(dependencies, { projectId: 7, scriptIds: [1, 2] });
    const names = staged.candidates.map((entry) => entry.canonicalName);
    return {
      gates: { "two-model-calls": environment.model.calls === 2, "review-addition": names.includes("吴广") },
      artifacts: { modelCallCount: environment.model.calls, candidateNames: names },
    };
  },

  "extraction-deterministic": async (environment) => {
    const dependencies = await seedExtraction(environment);
    environment.model.queue(extractionPayload(), reviewPayload());
    environment.model.queue(extractionPayload(), reviewPayload());
    const first = await runBaseAssetExtraction(dependencies, { projectId: 7, scriptIds: [2, 1] });
    const second = await runBaseAssetExtraction(dependencies, { projectId: 7, scriptIds: [1, 2] });
    const firstDigest = sha256(JSON.stringify(first));
    const secondDigest = sha256(JSON.stringify(second));
    return { gates: { "stable-output": firstDigest === secondDigest }, artifacts: { firstDigest, secondDigest } };
  },

  "extraction-derived-fold": async () => {
    const logs: Record<string, unknown>[] = [];
    const merged = mergeBaseAssetCandidates(
      [
        candidate({
          canonicalName: "大泽乡",
          type: "scene",
          scriptIds: [2],
          evidence: [{ scriptId: 2, excerpt: "大泽乡戍卒营地，连日暴雨", locator: "第1场" }],
        }),
        candidate({
          canonicalName: "大泽乡·雨夜",
          type: "scene",
          scriptIds: [2],
          evidence: [{ scriptId: 2, excerpt: "大泽乡戍卒营地，连日暴雨", locator: "第1场" }],
        }),
      ],
      EMPTY_AUDIT,
      { log: (entry) => logs.push(entry) },
    );
    const names = merged.map((entry) => entry.canonicalName);
    return {
      gates: { "derived-folded": !names.includes("大泽乡·雨夜"), "base-retained": names.includes("大泽乡") },
      artifacts: { candidateNames: names, mergeLogs: logs.map(({ requestId: _requestId, ...entry }) => entry) },
    };
  },

  "extraction-invalid-evidence": async (environment) => {
    const dependencies = await seedExtraction(environment);
    environment.model.queue(
      { assets: [candidate({ canonicalName: "虚构角色", evidence: [{ scriptId: 1, excerpt: "原文不存在的句子", locator: "第9场" }] })] },
      EMPTY_AUDIT,
    );
    let failureKind = "none";
    try {
      await runBaseAssetExtraction(dependencies, { projectId: 7, scriptIds: [1] });
    } catch (error) {
      failureKind = error instanceof BaseAssetExtractionFailure ? error.kind : "unexpected";
    }
    const assetCount = Number((await environment.db("o_assets").count("* as count").first())?.count ?? 0);
    return {
      gates: { "invalid-evidence-rejected": failureKind === "invalidOutput", "zero-write": assetCount === 0 },
      artifacts: { failureKind, assetCount },
    };
  },

  "prompt-reference-priority": async () => {
    const brief = loadBriefs()[0];
    const result = compileAssetGenerationPrompt({
      brief: {
        ...brief,
        referenceBindings: [
          referenceBinding("ref-low", 2, ["faceTopology", "robeTexture"]),
          referenceBinding("ref-high", 1, ["faceTopology"]),
        ],
      } as AssetBrief,
      modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE,
    });
    if (!result.ok) throw new Error(result.failure.kind);
    const dimensions = result.value.selectedBindings.flatMap((binding) => binding.controlledDimensions);
    return {
      gates: {
        "priority-wins": result.value.selectedBindings.some((binding) => binding.referenceId === "ref-high"),
        "no-duplicate-control": new Set(dimensions).size === dimensions.length,
      },
      artifacts: {
        selectedReferenceIds: result.value.selectedBindings.map((binding) => binding.referenceId),
        generationPromptHash: sha256(result.value.generationPrompt),
      },
    };
  },

  "prompt-no-reference": async () => {
    const result = compileAssetGenerationPrompt({ brief: loadBriefs()[0], modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE });
    if (!result.ok) throw new Error(result.failure.kind);
    return {
      gates: { "no-reference-clause": result.value.selectedBindings.length === 0 && result.value.referenceClause === "" },
      artifacts: { selectedReferenceIds: [], referenceClause: result.value.referenceClause },
    };
  },

  "prompt-character-contrast": async () => {
    const [huHai, wuGuang] = loadBriefs();
    const first = compileAssetGenerationPrompt({ brief: huHai, modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE });
    const second = compileAssetGenerationPrompt({ brief: wuGuang, modelProfile: AGNES_IMAGE_2_1_FLASH_PROFILE });
    if (!first.ok || !second.ok) throw new Error("prompt compile failed");
    return {
      gates: {
        "prompts-differ": first.value.generationPrompt !== second.value.generationPrompt,
        "identity-details": first.value.generationPrompt.includes("玄黑") && second.value.generationPrompt.includes("粗麻"),
      },
      artifacts: {
        promptHashes: [sha256(first.value.generationPrompt), sha256(second.value.generationPrompt)],
        identityMarkers: ["玄黑", "粗麻"],
      },
    };
  },

  "derived-multi-dimension": async () => {
    const result = compileDerivedAssetPrompt({
      assetName: "大泽乡·雨夜",
      parentAsset: { id: 101, name: "大泽乡" },
      instruction: {
        dimensions: ["weather", "time_of_day"],
        evidence: ["连日暴雨", "雨夜"],
        preserve: ["空间结构", "核心地标"],
        change: ["暴雨积水", "夜间火把照明"],
        exclude: ["人物", "晴天"],
      },
      manualKey: "art_scene_derivative",
      manualContent: "保持父场景空间身份，只表现声明的环境状态变化。",
      artStylePrefix: null,
    });
    if (!result.ok) throw new Error(result.failure.kind);
    const prompt = result.value.generationPrompt;
    return {
      gates: {
        "dimensions-composed": prompt.includes("天气状态") && prompt.includes("时段状态"),
        "contract-separated": prompt.includes("必须完整继承") && prompt.includes("本次仅允许") && prompt.includes("禁止出现"),
      },
      artifacts: { generationPromptHash: sha256(prompt), contractMarkers: ["preserve", "change", "exclude"] },
    };
  },

  "derived-invalid-contract": async () => {
    const result = compileDerivedAssetPrompt({
      assetName: "大泽乡·雨夜",
      parentAsset: { id: 101, name: "大泽乡" },
      instruction: { dimensions: ["weather"], evidence: [], preserve: [], change: ["暴雨"], exclude: [] },
      manualKey: "art_scene_derivative",
      manualContent: "环境变化手册",
      artStylePrefix: null,
    });
    const failureKind = result.ok ? "none" : result.failure.kind;
    return {
      gates: { "invalid-contract-rejected": failureKind === "derivedPromptCompilationFailed" },
      artifacts: { failureKind },
    };
  },

  "reference-limit": async (environment) => {
    await environment.db("o_project").insert({ id: 7, name: "项目", type: "短剧" });
    await environment.db("o_assets").insert({ id: 101, projectId: 7, name: "胡亥", type: "role" });
    await environment.db("o_assetReference").insert(
      Array.from({ length: 6 }, (_, index) => ({
        id: index + 1,
        projectId: 7,
        assetsId: 101,
        mediaPath: `/fake/${index}.png`,
        mediaMime: "image/png",
        orderIndex: index,
        description: `参考${index}`,
      })),
    );
    let mediaWriteCount = 0;
    const result = await createAssetReference(
      environment.work,
      { projectId: 7, assetsId: 101, description: "第七张" },
      {
        write: async () => {
          mediaWriteCount += 1;
          return { mediaPath: "/fake/seventh.png", mediaMime: "image/png" };
        },
        remove: async () => undefined,
      },
    );
    const failureKind = result.ok ? "none" : result.failure.kind;
    const referenceCount = Number((await environment.db("o_assetReference").count("* as count").first())?.count ?? 0);
    return {
      gates: {
        "seventh-rejected": failureKind === "referenceLimitExceeded" && referenceCount === 6,
        "no-media-side-effect": mediaWriteCount === 0,
      },
      artifacts: { failureKind, mediaWriteCount, referenceCount },
    };
  },

  "recovery-interrupted-images": async (environment) => {
    const before = ["等待中", "生成中", "下载中", "已完成", "已取消"];
    await environment.db("o_image").insert(
      before.map((state, index) => ({ id: index + 1, assetsId: index + 1, type: "role", state })),
    );
    await failInterruptedImageGenerations(environment.db);
    const after = (await environment.db("o_image").orderBy("id").pluck("state")) as string[];
    return {
      gates: {
        "active-failed": after.slice(0, 3).every((state) => state === "生成失败"),
        "terminal-preserved": after[3] === "已完成" && after[4] === "已取消",
      },
      artifacts: { statesBefore: before, statesAfter: after },
    };
  },

  "failure-diagnostic-redaction": async () => {
    const raw = "https://vendor.invalid/result?signature=secret token abc " + "A".repeat(100);
    const sanitizedText = sanitizeDiagnosticText(raw) ?? "";
    const sanitizedDiagnostic = sanitizeVendorImageFailureDiagnostics({
      kind: "transport",
      stage: "generation",
      attempt: 1,
      elapsedMs: 321,
      transportCode: "ECONNRESET",
      providerRequestId: "request-123",
    });
    return {
      gates: {
        "secret-redacted": !sanitizedText.includes("secret") && !sanitizedText.includes("A".repeat(80)),
        "safe-fields-retained": sanitizedDiagnostic.transportCode === "ECONNRESET" && sanitizedDiagnostic.elapsedMs === 321,
      },
      artifacts: { sanitizedDiagnostic, sanitizedText },
    };
  },

  "extraction-unknown-script": async (environment) => {
    const dependencies = await seedExtraction(environment);
    environment.model.queue(
      { assets: [candidate({ canonicalName: "越界角色", scriptIds: [99], evidence: [{ scriptId: 99, excerpt: "越界", locator: "第1场" }] })] },
      EMPTY_AUDIT,
    );
    let failureKind = "none";
    try {
      await runBaseAssetExtraction(dependencies, { projectId: 7, scriptIds: [1] });
    } catch (error) {
      failureKind = error instanceof BaseAssetExtractionFailure ? error.kind : "unexpected";
    }
    const assetCount = Number((await environment.db("o_assets").count("* as count").first())?.count ?? 0);
    return {
      gates: { "scope-rejected": failureKind === "invalidOutput", "zero-write": assetCount === 0 },
      artifacts: { failureKind, assetCount },
    };
  },

  "derived-reference-forbidden": async (environment) => {
    const result = await resolveDerivedAssetGenerationEntry(
      {
        work: environment.work,
        analyze: async () => ({ schemaVersion: "1", language: "zh-CN", worldBible: {}, contrastMatrix: [], assetBriefs: [] }) as never,
        loadSkillFile: async () => null,
        getArtStylePrefix: async () => null,
        getVisualManual: async () => null,
        now: () => 1_700_000_000_000,
      },
      {
        projectId: 7,
        asset: { id: 102, name: "雨夜", type: "scene", describe: null, assetsId: 101, briefType: "scene" },
        parent: null,
        references: [{ id: 1 } as AssetReferenceRecord],
        artStyle: null,
        manualContent: null,
        artStylePrefix: null,
      },
    );
    const failureKind = result.ok ? "none" : result.failure.kind;
    return {
      gates: {
        "reference-forbidden": failureKind === "derivedAssetReferenceForbidden",
        "no-external-call": environment.model.calls === 0 && environment.vendor.calls === 0,
      },
      artifacts: { failureKind, modelCallCount: environment.model.calls, vendorCallCount: environment.vendor.calls },
    };
  },

  "polling-missing-row": async (environment) => {
    await environment.db("o_assets").insert({ id: 101, projectId: 7, name: "无图资产", type: "role" });
    const rows = await readImageGenerationPollingRows(environment.db, [101, 999]);
    const pollingRows = [...rows.entries()].map(([id, row]) => ({ id, ...row }));
    return {
      gates: {
        "complete-denominator": rows.size === 2 && rows.has(101) && rows.has(999),
        "missing-is-terminally-visible": rows.get(101)?.state === null && rows.get(999)?.state === null,
      },
      artifacts: { pollingRows },
    };
  },

  "timeout-no-replay": async (environment) => {
    await environment.db("o_assets").insert({ id: 101, projectId: 7, name: "胡亥", type: "role" });
    environment.vendor.respondWith(
      new VendorImageGenerationError({ kind: "timeout", stage: "generation", attempt: 1, elapsedMs: 360_000 }),
    );
    const evidence = { mediaWrites: 0, taskStates: [] as Array<{ state: 1 | -1; reason?: string }> };
    const dependencies = imageDependencies(
      environment,
      async (_request, onStage) => {
        await onStage?.("generating");
        return (await environment.vendor.generateImage()) as string;
      },
      evidence,
    );
    const result = await generateAssetImage(dependencies, {
      projectId: 7,
      assetsId: 101,
      model: "fake:image-v1",
      resolution: "1K",
      generationInput: fixtureGenerationInput(),
    });
    const failureKind = result.ok ? "none" : result.failure.kind;
    const imageState = (await environment.db("o_image").where("assetsId", 101).first())?.state as string;
    return {
      gates: { "timeout-classified": failureKind === "imageGenerationTimeout", "single-call": environment.vendor.calls === 1 },
      artifacts: { failureKind, vendorCallCount: environment.vendor.calls, imageState, mediaWriteCount: evidence.mediaWrites },
    };
  },

  "late-success-after-cancel": async (environment) => {
    await environment.db("o_assets").insert({ id: 101, projectId: 7, name: "胡亥", type: "role" });
    const evidence = { mediaWrites: 0, taskStates: [] as Array<{ state: 1 | -1; reason?: string }> };
    let cancelled = false;
    const dependencies = imageDependencies(
      environment,
      async (_request, onStage) => {
        environment.vendor.calls += 1;
        await onStage?.("generating");
        await onStage?.("downloading");
        const active = await environment.db("o_image").where("assetsId", 101).orderBy("id", "desc").first();
        cancelled = await cancelImageGeneration(environment.db, Number(active.id));
        return "ZmFrZS1sYXRlLXN1Y2Nlc3M=";
      },
      evidence,
    );
    const result = await generateAssetImage(dependencies, {
      projectId: 7,
      assetsId: 101,
      model: "fake:image-v1",
      resolution: "1K",
      generationInput: fixtureGenerationInput(),
    });
    const image = await environment.db("o_image").where("assetsId", 101).orderBy("id", "desc").first();
    const finalState = image?.state as string;
    const failureKind = result.ok ? "none" : result.failure.kind;
    return {
      gates: {
        "cancel-wins": cancelled && failureKind === "cancelled" && finalState === "已取消",
        "late-write-fenced": environment.vendor.calls === 1 && evidence.mediaWrites === 0 && !image.filePath,
      },
      artifacts: {
        cancelled,
        lateUpdateCount: 0,
        finalState,
        failureKind,
        vendorCallCount: environment.vendor.calls,
        mediaWriteCount: evidence.mediaWrites,
      },
    };
  },

  "replacement-atomic-rollback": async (environment) => {
    await environment.db("o_project").insert({ id: 7, name: "项目", type: "短剧" });
    await environment.db("o_script").insert({ id: 1, name: "旧剧本", content: SCRIPT_1, projectId: 7, extractState: 2 });
    const [oldAssetId] = await environment.db("o_assets").insert({ projectId: 7, name: "旧资产", type: "role" });
    await environment.db("o_scriptAssets").insert({ scriptId: 1, assetId: oldAssetId });
    await environment.db.raw(
      "CREATE TRIGGER golden_fail_script_update BEFORE UPDATE ON o_script BEGIN SELECT RAISE(FAIL, 'golden forced failure'); END",
    );
    const merged = mergeBaseAssetCandidates([candidate({ canonicalName: "新资产", scriptIds: [1] })], EMPTY_AUDIT, {
      log: () => undefined,
    });
    const dependencies: ScriptAssetExtractionDependencies = {
      work: environment.work,
      openTextCall: environment.model.openTextCall,
      loadSkillFile: createDefaultBaseAssetSkillFileLoader(),
      now: () => 1_700_000_000_000,
      log: () => undefined,
      deleteMediaFile: async () => undefined,
    };
    let failureKind = "none";
    try {
      await replaceScriptAssetExtraction(dependencies, { projectId: 7, scriptIds: [1], candidates: merged });
    } catch (error) {
      failureKind = error instanceof BaseAssetExtractionFailure ? error.kind : "unexpected";
    }
    const assetsAfter = (await environment.db("o_assets").orderBy("id").select("id", "name")) as Array<{ id: number; name: string }>;
    const linksAfter = (await environment.db("o_scriptAssets").orderBy("scriptId").select("scriptId", "assetId")) as Array<{
      scriptId: number;
      assetId: number;
    }>;
    return {
      gates: {
        "stable-failure": failureKind === "persistenceFailed",
        "transaction-rolled-back":
          assetsAfter.length === 1 && assetsAfter[0].name === "旧资产" && linksAfter.length === 1 && linksAfter[0].assetId === oldAssetId,
      },
      artifacts: { failureKind, assetsAfter, linksAfter },
    };
  },
};

export async function executeGoldenScenario(caseId: string, scenario: string): Promise<ScenarioObservation> {
  const execute = scenarios[scenario];
  if (!execute) throw new Error(`Unknown Golden Eval scenario: ${scenario}`);
  const { environment, cleanup } = await createGoldenScenarioEnvironment(caseId);
  try {
    return await execute(environment);
  } finally {
    await cleanup();
  }
}

export const GOLDEN_SCENARIO_IDS = Object.freeze(Object.keys(scenarios).sort());
