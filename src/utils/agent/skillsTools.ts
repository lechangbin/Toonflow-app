import { tool } from "ai";
import { z } from "zod";
import path from "path";
import isPathInside from "is-path-inside";
import getPath from "@/utils/getPath";
import * as fs from "fs";

type SkillAttribution =
  //剧本Agent
  | "script_agent_decision"
  | "script_agent_execution"
  | "script_agent_supervision"
  //生产Agent
  | "production_agent_decision"
  | "production_agent_execution"
  | "production_agent_supervision";

interface SkillInput {
  mainSkill: SkillAttribution;
  workspace?: string[];
  attachedSkills?: string[];
}

interface SkillPaths {
  mainSkill: string;
  secondarySkills: string[];
  tertiarySkills: string[];
}

function toUnixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function ensureNonEmptyBody(body: string, fallback: string): string {
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

// ==================== 解析 SKILL.md ====================

function parseFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) throw new Error("No frontmatter found");

  const result: Record<string, string> = {};
  const lines = match[1].split("\n");

  for (let i = 0; i < lines.length; ) {
    const colonIndex = lines[i].indexOf(":");
    if (colonIndex === -1) {
      i++;
      continue;
    }

    const key = lines[i].slice(0, colonIndex).trim();
    if (!key) {
      i++;
      continue;
    }

    let value = lines[i].slice(colonIndex + 1).trim();
    i++;

    if (/^[>|]-?$/.test(value)) {
      const fold = value.startsWith(">");
      const parts: string[] = [];
      while (i < lines.length && /^\s+/.test(lines[i])) {
        parts.push(lines[i].trim());
        i++;
      }
      value = fold ? parts.join(" ") : parts.join("\n");
    }

    result[key] = value;
  }

  if (!result.name || !result.description) throw new Error("Frontmatter missing required field: name or description");
  return { name: result.name, description: result.description };
}

export async function useSkill(input: SkillInput, mem?: string) {
  const { mainSkill, workspace = [], attachedSkills = [] } = input;
  const rootDir = getPath("skills");
  const normalizedRootDir = path.resolve(rootDir);
  const mainPath = path.join(rootDir, mainSkill + ".md");
  if (!fs.existsSync(mainPath)) throw new Error(`主技能文件不存在: ${mainPath}`);
  if (!isPathInside(mainPath, normalizedRootDir)) throw new Error("技能名称无效：检测到路径穿越");

  const resolveSafeSkillDir = (dir: string): string | null => {
    const resolvedDir = path.resolve(normalizedRootDir, dir);
    const isSafeDir = resolvedDir === normalizedRootDir || isPathInside(resolvedDir, normalizedRootDir);
    return isSafeDir ? resolvedDir : null;
  };

  const getMdFiles = (dir: string, recursive = false): string[] => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(".md")) return [fullPath];
      return entry.isDirectory() && recursive ? getMdFiles(fullPath, true) : [];
    });
  };
  const collectMdFiles = (dirs: string[], recursive: boolean) =>
    dirs.flatMap((dir) => {
      const safeDir = resolveSafeSkillDir(dir);
      if (!safeDir) return [];
      return getMdFiles(safeDir, recursive).map((file) => toUnixPath(path.relative(normalizedRootDir, file)));
    });

  const skillPaths: SkillPaths = {
    mainSkill: mainPath,
    secondarySkills: collectMdFiles(workspace, false),
    tertiarySkills: collectMdFiles(attachedSkills, true),
  };

  const content = await fs.promises.readFile(mainPath, "utf-8");
  const skill = parseFrontmatter(content);
  return { prompt: buildPrompt(skill), tools: createSkillTools(skill, skillPaths, mem) };
}

function buildPrompt(skill: { name: string; description: string }): string {
  return `## Skills
以下技能提供了专业任务的专用指令。
当任务与某个技能的描述匹配时，调用 activate_skill 工具并传入技能名称来加载完整指令。
加载后遵循技能指令执行任务，需要时调用 read_skill_file 读取资源文件内容。

<available_skills>
  <skill>
    <name>${skill.name}</name>
    <description>${skill.description}</description>
  </skill>
</available_skills>`;
}

function createSkillTools(skill: { name: string; description: string }, skillPaths: SkillPaths, mem?: string) {
  const activated = new Set<string>(); // 已激活技能集合，防止重复加载
  const skillsRootDir = path.resolve(getPath("skills"));
  return {
    activate_skill: tool({
      description: `激活一个技能，加载其完整指令和捆绑资源列表到上下文。可用技能：${skill.name}`,
      inputSchema: z.object({
        name: z.enum([skill.name] as [string, ...string[]]).describe("要激活的技能名称"),
      }),
      execute: async ({ name }) => {
        if (activated.has(name)) {
          console.log(`⚡[主技能] ℹ️ 技能 "${name}" 已激活，跳过重复注入`);
          return { alreadyActive: true, message: `技能 "${name}" 已激活，无需重复加载` };
        }
        let raw = "";
        try {
          raw = await fs.promises.readFile(skillPaths.mainSkill, "utf-8");
          console.log(`⚡[主技能] ✓ 已读取主技能文件： ${skillPaths.mainSkill}（${raw.length} 字符）`);
        } catch (error) {
          console.log(`⚡[主技能] ✗ 读取失败：未找到文件 "${skillPaths.mainSkill}"`);
        }
        activated.add(name);
        console.log(`⚡[主技能] ✓ 技能 "${name}" 已激活`);
        const body = ensureNonEmptyBody(raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""), "该技能文件无正文内容。");
        let content = "";
        content = `<skill_content name="${name}">\n`;
        content += body + "\n\n";
        content += "使用 read_skill_file 工具读取资源文件。\n";
        if (skillPaths.secondarySkills.length > 0) {
          content += "\n<skill_resources>\n";
          for (const path of skillPaths.secondarySkills) {
            content += `  <file>${path}</file>\n`;
          }
          content += "</skill_resources>\n";
        }
        content += "</skill_content>";
        if (mem) {
          content += `\n<memory>\n` + mem + `\n</memory>`;
        }
        console.log("%c Line:173 🍕 content", "background:#fca650", content);
        return { content };
      },
    }),
    read_skill_file: tool({
      description: "读取已激活技能目录下的资源文件。传入 activate_skill 返回的 skill_resources 中的文件路径。",
      inputSchema: z.object({
        filePath: z.string().describe("资源文件的相对路径，来自 activate_skill 返回的 skill_resources"),
      }),
      execute: async ({ filePath }) => {
        const normalizedInputPath = toUnixPath(filePath).trim();
        if (!normalizedInputPath) {
          console.log(`📖[技法文件] ✗ filePath 不能为空`);
          return { error: "filePath 不能为空" };
        }

        const fullPath = path.resolve(path.join(skillsRootDir, normalizedInputPath));
        if (!(fullPath === skillsRootDir || isPathInside(fullPath, skillsRootDir))) {
          console.log(`📖[技法文件] ✗ 路径越界已拦截："${filePath}" 超出技能目录范围`);
          return { error: "Access denied: path is outside skill directory" };
        }
        let body = "";
        try {
          body = await fs.promises.readFile(fullPath, "utf-8");
          console.log(`📖[技法文件] ✓ 已读取文件： ${filePath}（${body.length} 字符）`);
        } catch {
          console.log(`📖[技法文件] ✗ 读取失败：未找到文件 "${filePath}"`);
          return { error: `File not found: ${filePath}` };
        }
        const safeBody = ensureNonEmptyBody(body, "该资源文件为空。");
        let content = "";
        content = `<skill_content>\n`;
        content += safeBody + "\n\n";
        content += "可以使用 read_skill_file 工具读取资源文件。\n";
        if (skillPaths.tertiarySkills.length > 0) {
          content += "\n<skill_resources>\n";
          for (const path of skillPaths.tertiarySkills) {
            content += `  <file>${path}</file>\n`;
          }
          content += "</skill_resources>\n";
        }
        content += "</skill_content>";
        console.log("%c Line:214 🍕 content", "background:#6ec1c2", content);
        return { content };
      },
    }),
  };
}
