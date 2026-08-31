import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const SRC_ROOT = path.join(process.cwd(), "src");

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
    } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function toRelative(file: string): string {
  return path.relative(SRC_ROOT, file).replace(/\\/g, "/");
}

const sourceFiles = listSourceFiles(SRC_ROOT);

/**
 * Legacy execution paths deleted in #24. Business code may no longer reach the
 * database through the old global helper or load programmable Vendor code
 * through the old ai/vendor modules.
 */
const forbiddenPatterns: { description: string; pattern: RegExp }[] = [
  { description: "u.Ai 全局 AI 定位器", pattern: /\bu\s*\.\s*Ai\b/ },
  { description: "u.vendor 全局 Vendor 定位器", pattern: /\bu\s*\.\s*vendor\b/ },
  { description: "u.db( 原始数据库句柄", pattern: /\bu\s*\.\s*db\s*\(/ },
  { description: "旧 ai 模块导入", pattern: /["']@\/utils\/ai["']/ },
  { description: "旧 vendor 模块导入", pattern: /["']@\/utils\/vendor["']/ },
  { description: "旧 database bridge 导入", pattern: /["']@\/database\/bridge["']/ },
];

test("业务代码禁止使用已删除的旧执行路径", () => {
  const violations: string[] = [];
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const { description, pattern } of forbiddenPatterns) {
      if (pattern.test(source)) {
        violations.push(`${toRelative(file)}: ${description}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("源级 runtime 加载只允许出现在内部 seam 与测试中", () => {
  const allowed = new Set([
    "lib/vendorRuntime.ts",
    "vendor/loader.ts",
    "vendor/config.ts",
    "video/bootstrap.ts",
  ]);
  const violations = sourceFiles
    .filter((file) => fs.readFileSync(file, "utf8").includes("loadVendorRuntime"))
    .map(toRelative)
    .filter((relative) => !allowed.has(relative));
  assert.deepEqual(violations, []);
});

test("仓库中只有一个 database readiness 实现", () => {
  for (const removed of ["utils/db.ts", "database/bridge.ts", "utils/ai.ts", "utils/vendor.ts"]) {
    assert.equal(fs.existsSync(path.join(SRC_ROOT, removed)), false, `${removed} 必须保持删除`);
  }
  const readinessImplementations = sourceFiles
    .filter((file) => /export (async )?function openDatabase\b/.test(fs.readFileSync(file, "utf8")))
    .map(toRelative);
  assert.deepEqual(readinessImplementations, ["database/index.ts"]);
});

test("仓库中只有一个内置 Vendor registry 与一个 configured Vendor loader", () => {
  const registries = sourceFiles
    .filter((file) => /export const BUILT_IN_VENDOR_REGISTRY/.test(fs.readFileSync(file, "utf8")))
    .map(toRelative);
  assert.deepEqual(registries, ["lib/vendorRegistry.ts"]);

  const loaders = sourceFiles
    .filter((file) => /export (async )?function loadConfiguredVendor\b/.test(fs.readFileSync(file, "utf8")))
    .map(toRelative);
  assert.deepEqual(loaders, ["vendor/loader.ts"]);

  const defaultEntries = sourceFiles
    .filter((file) => /export function getDefaultConfiguredVendor\b/.test(fs.readFileSync(file, "utf8")))
    .map(toRelative);
  assert.deepEqual(defaultEntries, ["vendor/index.ts"]);
});
