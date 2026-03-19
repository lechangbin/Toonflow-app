import { tool } from "ai";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import isPathInside from "is-path-inside";
import getPath from "@/utils/getPath";

// ==================== 类型 ====================

interface SkillRecord {
  name: string;
  description: string;
  location: string; // SKILL.md 绝对路径
  baseDir: string; // skill 目录绝对路径
}

// ==================== Step 2: 解析 SKILL.md ====================

/**
 * 解析 SKILL.md frontmatter
 * 支持 YAML 单行值及多行块标量（>、>-、|、|-）
 */
function parseFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) throw new Error("No frontmatter found");

  const result: Record<string, string> = {};
  const lines = match[1].split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) { i++; continue; }

    const key = line.slice(0, colonIndex).trim();
    if (!key) { i++; continue; }

    let value = line.slice(colonIndex + 1).trim();

    // 检测 YAML 块标量指示符 (>, >-, |, |-)
    if (/^[>|]-?$/.test(value)) {
      const fold = value.startsWith(">");
      const parts: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        // 缩进行属于当前块
        if (/^\s+/.test(next)) {
          parts.push(next.trim());
          i++;
        } else {
          break;
        }
      }
      value = fold ? parts.join(" ") : parts.join("\n");
    } else {
      i++;
    }

    result[key] = value;
  }

  if (!result.name) throw new Error("Frontmatter missing required field: name");
  if (!result.description) throw new Error("Frontmatter missing required field: description");

  return { name: result.name, description: result.description };
}

/**
 * 去除 frontmatter，返回正文（body）
 */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

// ==================== 资源枚举 ====================

/**
 * 递归扫描目录，返回相对路径列表（排除 SKILL.md）
 */
async function listResources(dir: string, base: string = ""): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listResources(path.join(dir, entry.name), rel)));
    } else if (entry.name !== "SKILL.md") {
      files.push(rel);
    }
  }
  return files;
}

// ==================== Step 1: 发现 skills ====================

/**
 * 扫描指定目录，发现所有包含 SKILL.md 的子目录
 */
async function discoverSkills(directories: string[]): Promise<SkillRecord[]> {
  const skills: SkillRecord[] = [];
  const seenNames = new Set<string>();

  for (const dir of directories) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const baseDir = path.join(dir, entry.name);
      const location = path.join(baseDir, "SKILL.md");

      let content: string;
      try {
        content = await fs.readFile(location, "utf-8");
      } catch {
        continue;
      }

      let metadata: { name: string; description: string };
      try {
        metadata = parseFrontmatter(content);
      } catch (e) {
        console.log(`[Skill] ⚠️ 跳过 "${entry.name}"：${(e as Error).message}`);
        continue;
      }

      // 宽松校验：name 与目录名不匹配时仅告警
      if (metadata.name !== entry.name) {
        console.log(`[Skill] ⚠️ 技能名 "${metadata.name}" 与目录名 "${entry.name}" 不一致，仍加载`);
      }
      if (metadata.name.length > 64) {
        console.log(`[Skill] ⚠️ 技能名 "${metadata.name}" 超过 64 字符，仍加载`);
      }

      // 先发现的同名 skill 优先（项目级覆盖用户级）
      if (seenNames.has(metadata.name)) {
        console.log(`[Skill] ⚠️ 技能 "${metadata.name}" 名称冲突，已被先前发现的同名技能覆盖`);
        continue;
      }
      seenNames.add(metadata.name);

      skills.push({
        name: metadata.name,
        description: metadata.description,
        location,
        baseDir,
      });

      console.log(`[Skill] ✅ 发现技能：${metadata.name} — ${metadata.description}`);
    }
  }

  return skills;
}

// ==================== Step 3: 构建技能目录 ====================

/**
 * 构建 XML 格式的技能目录 + 行为指令，注入到 system prompt
 */
function buildCatalog(skills: SkillRecord[]): string {
  if (skills.length === 0) return "";

  const skillsXml = skills
    .map(
      (s) =>
        `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n  </skill>`
    )
    .join("\n");

  return [
    "## Skills",
    "以下技能提供了专业任务的专用指令。",
    "当任务与某个技能的描述匹配时，调用 activate_skill 工具并传入技能名称来加载完整指令。",
    "加载后遵循技能指令执行任务，需要时调用 read_skill_file 读取资源文件内容。",
    "",
    "<available_skills>",
    skillsXml,
    "</available_skills>",
  ].join("\n");
}

// ==================== Step 4 & 5: 激活 + 执行工具 ====================

/**
 * 创建 activate_skill 和 read_skill_file 工具
 */
function createSkillTools(skills: SkillRecord[]) {
  // 激活去重：记录当前会话已激活的 skill
  const activated = new Set<string>();

  const validNames = skills.map((s) => s.name);

  return {
    activate_skill: tool({
      description: `激活一个技能，加载其完整指令和捆绑资源列表到上下文。可用技能：${validNames.join(", ")}`,
      inputSchema: z.object({
        name: z.enum(validNames as [string, ...string[]]).describe("要激活的技能名称"),
      }),
      execute: async ({ name }) => {
        const skill = skills.find((s) => s.name === name);
        if (!skill) {
          console.log(`[Skill] ❌ 激活失败：未找到技能 "${name}"`);
          return { error: `Skill '${name}' not found` };
        }

        // Step 5: 去重检查
        if (activated.has(name)) {
          console.log(`[Skill] ℹ️ 技能 "${name}" 已在当前会话中激活，跳过重复注入`);
          return { already_active: true, message: `技能 "${name}" 已激活，无需重复加载` };
        }

        let content: string;
        try {
          content = await fs.readFile(skill.location, "utf-8");
        } catch {
          console.log(`[Skill] ❌ 激活失败：无法读取 ${skill.location}`);
          return { error: `Failed to read SKILL.md for '${name}'` };
        }

        const body = stripFrontmatter(content);
        const resources = await listResources(skill.baseDir);

        activated.add(name);

        const resourcesXml =
          resources.length > 0
            ? `\n<skill_resources>\n${resources.map((f) => `  <file>${f}</file>`).join("\n")}\n</skill_resources>`
            : "";

        const wrapped = [
          `<skill_content name="${skill.name}">`,
          body,
          "",
          `Skill directory: ${skill.baseDir}`,
          `相对路径基于此技能目录解析，使用 read_skill_file 工具读取资源文件。`,
          resourcesXml,
          `</skill_content>`,
        ].join("\n");

        console.log(
          `[Skill] 📖 已激活技能：${skill.name}（${body.length} 字符，${resources.length} 个资源文件）`
        );

        return { content: wrapped };
      },
    }),

    read_skill_file: tool({
      description: "读取已激活技能目录下的资源文件。传入 activate_skill 返回的 skill_resources 中的文件路径。",
      inputSchema: z.object({
        skillName: z.string().describe("技能名称"),
        filePath: z.string().describe("资源文件的相对路径，来自 activate_skill 返回的 skill_resources"),
      }),
      execute: async ({ skillName, filePath: relPath }) => {
        const skill = skills.find((s) => s.name === skillName);
        if (!skill) {
          console.log(`[Skill] ❌ 读取失败：未找到技能 "${skillName}"`);
          return { error: `Skill '${skillName}' not found` };
        }

        const fullPath = path.resolve(path.join(skill.baseDir, relPath));

        if (!isPathInside(fullPath, skill.baseDir)) {
          console.log(`[Skill] 🚫 路径越界已拦截："${relPath}" 超出技能目录范围`);
          return { error: "Access denied: path is outside skill directory" };
        }

        try {
          const fileContent = await fs.readFile(fullPath, "utf-8");
          console.log(`[Skill] 📄 已读取文件：${skillName}/${relPath}（${fileContent.length} 字符）`);
          return { content: fileContent };
        } catch {
          console.log(`[Skill] ❌ 读取失败：未找到文件 "${relPath}"`);
          return { error: `File not found: ${relPath}` };
        }
      },
    }),
  };
}

// ==================== 对外接口 ====================

/**
 * 使用指定 skill（渐进式披露）
 *
 * 遵循 agentskills.io 规范：
 *   Step 1 — Discovery: 扫描 data/skills/{name} 目录
 *   Step 2 — Parse: 提取 frontmatter 元数据
 *   Step 3 — Disclose: 构建 XML 目录注入 system prompt
 *   Step 4 — Activate: activate_skill 工具加载完整指令 + 结构化包装 + 资源列表
 *   Step 5 — Manage: read_skill_file 读取资源 + 激活去重
 *
 * @param name skill 名称，对应 data/skills/{name} 目录
 */
export async function useSkill(name: string) {
  const skills = await discoverSkills([getPath("skills")]);

  // 过滤出指定 skill
  const matched = skills.filter((s) => s.name === name);
  if (matched.length === 0) {
    console.log(`[Skill] ⚠️ 未发现名为 "${name}" 的技能`);
    return { prompt: "", tools: {} };
  }

  return {
    prompt: buildCatalog(matched),
    tools: createSkillTools(matched),
  };
}
