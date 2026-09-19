import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import knexFactory, { type Knex } from "knex";

import {
  IMAGE_GENERATION_ACTIVE_STATES,
  IMAGE_GENERATION_LIFECYCLE_STATES,
  IMAGE_GENERATION_TERMINAL_STATES,
  VendorImageGenerationError,
  classifyVendorImageFailure,
  cancelImageGeneration,
  extractVendorImageFailure,
  failInterruptedImageGenerations,
  imageFailureKindFromStoredReason,
  isImageGenerationActiveState,
  isImageGenerationTerminalState,
  sanitizeDiagnosticText,
  sanitizeVendorImageFailureDiagnostics,
} from "../src/assets/imageGenerationLifecycle";

test("生命周期契约包含六个状态且活跃/终态划分完整", () => {
  assert.deepEqual([...IMAGE_GENERATION_LIFECYCLE_STATES], [
    "等待中",
    "生成中",
    "下载中",
    "已完成",
    "生成失败",
    "已取消",
  ]);
  assert.deepEqual([...IMAGE_GENERATION_ACTIVE_STATES], ["等待中", "生成中", "下载中"]);
  assert.deepEqual([...IMAGE_GENERATION_TERMINAL_STATES], ["已完成", "生成失败", "已取消"]);
  for (const state of IMAGE_GENERATION_ACTIVE_STATES) {
    assert.equal(isImageGenerationActiveState(state), true);
    assert.equal(isImageGenerationTerminalState(state), false);
  }
  for (const state of IMAGE_GENERATION_TERMINAL_STATES) {
    assert.equal(isImageGenerationTerminalState(state), true);
    assert.equal(isImageGenerationActiveState(state), false);
  }
  assert.equal(isImageGenerationActiveState("不是状态"), false);
  assert.equal(isImageGenerationActiveState(null), false);
});

test("进程重启恢复：非终态统一落为生成失败，终态不被改写", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-lifecycle-restart-"));
  const knex: Knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(directory, "db.sqlite") },
    useNullAsDefault: true,
  });
  try {
    await knex.schema.createTable("o_image", (table) => {
      table.integer("id").primary();
      table.string("state");
      table.string("errorReason");
    });
    await knex("o_image").insert([
      { id: 1, state: "等待中", errorReason: null },
      { id: 2, state: "生成中", errorReason: null },
      { id: 3, state: "下载中", errorReason: null },
      { id: 4, state: "已完成", errorReason: null },
      { id: 5, state: "生成失败", errorReason: "imageGenerationTimeout:" + "a".repeat(64) },
      { id: 6, state: "已取消", errorReason: null },
    ]);

    await failInterruptedImageGenerations(knex);

    const rows = await knex("o_image").select().orderBy("id");
    assert.equal(rows[0].state, "生成失败");
    assert.equal(rows[0].errorReason, "软件退出导致失败");
    assert.equal(rows[1].state, "生成失败");
    assert.equal(rows[2].state, "生成失败");
    assert.equal(rows[3].state, "已完成", "重启恢复不得改写已完成");
    assert.equal(rows[4].state, "生成失败");
    assert.match(String(rows[4].errorReason), /^imageGenerationTimeout:/u, "既有失败原因不被覆盖");
    assert.equal(rows[5].state, "已取消", "重启恢复不得改写已取消");
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("诊断脱敏：白名单字段、base64 与签名 URL 移除、文本截断", () => {
  const sanitized = sanitizeVendorImageFailureDiagnostics({
    kind: "timeout",
    stage: "download",
    attempt: 2,
    elapsedMs: 360123,
    transportCode: "ECONNABORTED",
    httpStatus: undefined,
    providerRequestId: "req-1234567890",
    message: "Authorization: Bearer sk-short；提示词：完整提示词",
    // 非白名单字段必须被丢弃
    authorization: "Bearer sk-secret",
    prompt: "完整提示词",
  } as never);

  assert.equal(sanitized.kind, "timeout");
  assert.equal(sanitized.stage, "download");
  assert.equal(sanitized.attempt, 2);
  assert.equal(sanitized.elapsedMs, 360123);
  assert.equal(sanitized.transportCode, "ECONNABORTED");
  assert.ok(!("httpStatus" in sanitized));
  assert.equal(sanitized.providerRequestId, "req-1234567890");
  assert.ok(!("authorization" in sanitized), "凭证字段必须被白名单丢弃");
  assert.ok(!("prompt" in sanitized), "提示词必须被白名单丢弃");
  const serialized = JSON.stringify(sanitized);
  assert.ok(!serialized.includes("sk-secret"), "凭证不得出现");
  assert.ok(!serialized.includes("sk-short"), "短凭证不得出现");
  assert.ok(!serialized.includes("完整提示词"), "供应商消息/提示词回显不得持久化");
  assert.ok(!("message" in sanitized), "自由文本消息不属于可持久化诊断白名单");
});

test("诊断兜底：非法枚举与数值被规范化", () => {
  const sanitized = sanitizeVendorImageFailureDiagnostics({
    kind: "not-a-kind",
    stage: "somewhere",
    attempt: -3,
    elapsedMs: Number.NaN,
    httpStatus: 0,
    transportCode: "",
  } as never);
  assert.equal(sanitized.kind, "transport");
  assert.equal(sanitized.stage, "generation");
  assert.equal(sanitized.attempt, 1);
  assert.ok(!("elapsedMs" in sanitized));
  assert.ok(!("httpStatus" in sanitized));
  assert.ok(!("transportCode" in sanitized));
});

test("诊断请求 ID 只接受安全的不透明标识符", () => {
  assert.equal(
    sanitizeVendorImageFailureDiagnostics({
      kind: "transport",
      stage: "generation",
      attempt: 1,
      providerRequestId: "req_123:part-4",
    }).providerRequestId,
    "req_123:part-4",
  );
  assert.equal(
    sanitizeVendorImageFailureDiagnostics({
      kind: "transport",
      stage: "generation",
      attempt: 1,
      providerRequestId: "Bearer sk-short",
    }).providerRequestId,
    undefined,
  );
});

test("取消迁移由共享生命周期边界守卫终态", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-lifecycle-cancel-"));
  const knex: Knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(directory, "db.sqlite") },
    useNullAsDefault: true,
  });
  try {
    await knex.schema.createTable("o_image", (table) => {
      table.integer("id").primary();
      table.string("state");
    });
    await knex("o_image").insert([
      { id: 1, state: "等待中" },
      { id: 2, state: "生成中" },
      { id: 3, state: "下载中" },
      { id: 4, state: "已完成" },
    ]);
    assert.equal(await cancelImageGeneration(knex, 1), true);
    assert.equal(await cancelImageGeneration(knex, 2), true);
    assert.equal(await cancelImageGeneration(knex, 3), true);
    assert.equal(await cancelImageGeneration(knex, 4), false);
    assert.deepEqual(
      (await knex("o_image").orderBy("id").pluck("state")),
      ["已取消", "已取消", "已取消", "已完成"],
    );
  } finally {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("sanitizeDiagnosticText 移除普通 URL 并截断", () => {
  const output = sanitizeDiagnosticText("请求 https://example.com/a/b 失败，" + "x".repeat(300));
  assert.ok(!output?.includes("https://example.com"));
  assert.ok((output ?? "").length <= 200);
  assert.equal(sanitizeDiagnosticText(undefined), undefined);
  assert.equal(sanitizeDiagnosticText("   "), undefined);
});

test("供应商失败分类：超时、下载失败与普通失败分别落稳定 kind", () => {
  assert.equal(
    classifyVendorImageFailure(new VendorImageGenerationError({ kind: "timeout", stage: "generation", attempt: 1 })),
    "imageGenerationTimeout",
  );
  assert.equal(
    classifyVendorImageFailure(new VendorImageGenerationError({ kind: "downloadFailed", stage: "download", attempt: 1 })),
    "imageDownloadFailed",
  );
  assert.equal(
    classifyVendorImageFailure(new VendorImageGenerationError({ kind: "httpError", stage: "generation", attempt: 1 })),
    "imageGenerationFailed",
  );
  assert.equal(
    classifyVendorImageFailure(new VendorImageGenerationError({ kind: "noImageData", stage: "generation", attempt: 1 })),
    "imageGenerationFailed",
  );
  // 适配器未携带结构化诊断时的超时特征兜底（生产事故指纹）
  assert.equal(classifyVendorImageFailure(new Error("Agnes 图片生成失败：timeout of 360000ms exceeded")), "imageGenerationTimeout");
  assert.equal(classifyVendorImageFailure(Object.assign(new Error("polling"), { code: "ETIMEDOUT" })), "imageGenerationTimeout");
  assert.equal(classifyVendorImageFailure(Object.assign(new Error("aborted"), { code: "ECONNABORTED" })), "imageGenerationTimeout");
  assert.equal(classifyVendorImageFailure(new Error("HTTP 500 上游错误")), "imageGenerationFailed");
});

test("extractVendorImageFailure 从 VM 边界普通对象提取并脱敏诊断", () => {
  const plainError: { message: string; imageFailure?: unknown } = {
    message: "Agnes 图片生成失败",
    imageFailure: {
      kind: "timeout",
      stage: "generation",
      attempt: 3,
      elapsedMs: 1080000,
      message: "https://signed.example.com/x?expires=1&token=SECRET",
    },
  };
  const diagnostics = extractVendorImageFailure(plainError);
  assert.equal(diagnostics?.kind, "timeout");
  assert.equal(diagnostics?.attempt, 3);
  assert.ok(!JSON.stringify(diagnostics).includes("SECRET"));
  assert.equal(extractVendorImageFailure(new Error("plain")), null);
  assert.equal(extractVendorImageFailure(null), null);
  const typed = new VendorImageGenerationError({ kind: "transport", stage: "generation", attempt: 1 });
  assert.equal(extractVendorImageFailure(typed)?.kind, "transport");
});

test("轮询 errorKind 从存储的 kind:hash 指纹还原", () => {
  assert.equal(imageFailureKindFromStoredReason("imageGenerationTimeout:" + "a".repeat(64)), "imageGenerationTimeout");
  assert.equal(imageFailureKindFromStoredReason("imageDownloadFailed:" + "b".repeat(64)), "imageDownloadFailed");
  assert.equal(imageFailureKindFromStoredReason("imagePersistenceFailed:" + "c".repeat(64)), "imagePersistenceFailed");
  assert.equal(imageFailureKindFromStoredReason("软件退出导致失败"), null);
  assert.equal(imageFailureKindFromStoredReason(null), null);
  assert.equal(imageFailureKindFromStoredReason(""), null);
});
