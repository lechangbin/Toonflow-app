import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";
import isPathInside from "is-path-inside";
import type { Knex } from "knex";

import { parseVideoPromptProfile } from "@/video/promptProfile";

export type PromptCatalogKind = "system" | "skill" | "video-profile" | "model-prompt";

export interface PromptCatalogEntry {
  key: string;
  name: string;
  category: string;
  kind: PromptCatalogKind;
  source: string;
  customized: boolean;
  resettable: boolean;
}

const fileRoots = {
  skill: "skills",
  "video-profile": "promptProfiles",
  "model-prompt": "modelPrompt",
} as const;

type FilePromptKind = keyof typeof fileRoots;

function displayName(relativePath: string): string {
  return path.basename(relativePath, path.extname(relativePath)).replace(/[_-]+/g, " ");
}

function skillCategory(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.startsWith("art_skills/")) return "visual-skill";
  if (normalized.startsWith("story_skills/")) return "story-skill";
  if (normalized.startsWith("production_skills/") || normalized.startsWith("production_")) return "production-agent";
  if (normalized.startsWith("script_")) return "script-agent";
  return "agent-skill";
}

async function listFileEntries(dataRoot: string, kind: FilePromptKind): Promise<PromptCatalogEntry[]> {
  const root = path.join(dataRoot, fileRoots[kind]);
  const entries = await fg("**/*.md", { cwd: root.replace(/\\/g, "/"), onlyFiles: true }).catch(() => [] as string[]);
  return entries
    .filter((entry) => path.basename(entry).toLowerCase() !== "readme.md")
    .map((entry) => ({
      key: `${kind}:${entry.replace(/\\/g, "/")}`,
      name: displayName(entry),
      category: kind === "skill" ? skillCategory(entry) : kind,
      kind,
      source: entry.replace(/\\/g, "/"),
      customized: false,
      resettable: false,
    }));
}

export async function listPromptCatalog(database: Knex, dataRoot: string): Promise<PromptCatalogEntry[]> {
  const systemRows = await database("o_prompt").select("id", "name", "type", "useData");
  const systemEntries: PromptCatalogEntry[] = systemRows.map((row) => ({
    key: `system:${row.type}`,
    name: row.name || row.type,
    category: "system",
    kind: "system",
    source: row.type,
    customized: typeof row.useData === "string" && row.useData.length > 0,
    resettable: true,
  }));
  const fileEntries = await Promise.all(
    (Object.keys(fileRoots) as FilePromptKind[]).map((kind) => listFileEntries(dataRoot, kind)),
  );
  return [...systemEntries, ...fileEntries.flat()].sort((a, b) =>
    a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category),
  );
}

function parseFileKey(key: string): { kind: FilePromptKind; relativePath: string } | null {
  const separator = key.indexOf(":");
  if (separator < 1) return null;
  const kind = key.slice(0, separator) as FilePromptKind;
  if (!(kind in fileRoots)) return null;
  const relativePath = key.slice(separator + 1).replace(/\\/g, "/");
  return { kind, relativePath };
}

async function resolveFile(dataRoot: string, key: string): Promise<{ kind: FilePromptKind; filePath: string }> {
  const parsed = parseFileKey(key);
  if (!parsed || !parsed.relativePath.endsWith(".md")) throw new Error("无效的提示词标识");
  const root = path.resolve(dataRoot, fileRoots[parsed.kind]);
  const filePath = path.resolve(root, parsed.relativePath);
  if (!(filePath === root || isPathInside(filePath, root))) throw new Error("提示词路径超出允许范围");
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new Error("提示词文件不存在");
  return { kind: parsed.kind, filePath };
}

export async function readPromptCatalogEntry(database: Knex, dataRoot: string, key: string): Promise<string> {
  if (key.startsWith("system:")) {
    const type = key.slice("system:".length);
    const row = await database("o_prompt").where("type", type).first();
    if (!row) throw new Error("系统提示词不存在");
    return row.useData || row.data || "";
  }
  const { filePath } = await resolveFile(dataRoot, key);
  return fs.readFile(filePath, "utf8");
}

export async function updatePromptCatalogEntry(
  database: Knex,
  dataRoot: string,
  key: string,
  content: string,
): Promise<void> {
  if (!content.trim()) throw new Error("提示词内容不能为空");
  if (key.startsWith("system:")) {
    const type = key.slice("system:".length);
    const updated = await database("o_prompt").where("type", type).update({ useData: content });
    if (!updated) throw new Error("系统提示词不存在");
    return;
  }
  const { kind, filePath } = await resolveFile(dataRoot, key);
  if (kind === "video-profile") parseVideoPromptProfile(content, filePath);
  await fs.writeFile(filePath, content, "utf8");
}

export async function resetPromptCatalogEntry(database: Knex, key: string): Promise<void> {
  if (!key.startsWith("system:")) throw new Error("该提示词不支持恢复默认值");
  const type = key.slice("system:".length);
  const updated = await database("o_prompt").where("type", type).update({ useData: null });
  if (!updated) throw new Error("系统提示词不存在");
}
