import { tool } from "ai";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import isPathInside from "is-path-inside";
import u from "@/utils";
import getPath from "@/utils/getPath";
import { getEmbedding, cosineSimilarity } from "./embedding";

interface SkillRecord {
  name: string;
  description: string;
  location: string;
  baseDir: string;
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

type SkillAttribution =
  | "production_agent_decision.md"
  | "production_agent_execution.md"
  | "production_agent_supervision.md"
  | "script_agent_decision.md"
  | "script_agent_execution.md"
  | "script_agent_supervision.md"
  | "universal_agent.md";

export async function useSkill(mainSkillName: SkillAttribution) {
  const skillsRoot = getPath("skills");
  const targetSkill = path.join(skillsRoot, mainSkillName);

  if (!isPathInside(targetSkill, skillsRoot)) throw new Error("技能名称无效：检测到路径穿越");

  try {
    const content = await fs.readFile(targetSkill, "utf-8");
    const skill = { ...parseFrontmatter(content), location: targetSkill, baseDir: skillsRoot };
    return { prompt: buildPrompt(skill), tools: createSkillTools(skill, mainSkillName) };
  } catch {
    throw new Error(`技能文件不存在：${mainSkillName}`);
  }
}

function buildPrompt(skill: SkillRecord): string {
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

function createSkillTools(skill: SkillRecord, mainSkillName: string) {
  const activated = new Set<string>();
  return {
    activate_skill: tool({
      description: `激活一个技能，加载其完整指令和捆绑资源列表到上下文。可用技能：${skill.name}`,
      inputSchema: z.object({
        name: z.enum([skill.name] as [string, ...string[]]).describe("要激活的技能名称"),
      }),
      execute: async ({ name }) => {
        if (activated.has(name)) {
          console.log(`[Skill] ℹ️ 技能 "${name}" 已激活，跳过重复注入`);
          return { alreadyActive: true, message: `技能 "${name}" 已激活，无需重复加载` };
        }
        let raw: string;
        try {
          raw = await fs.readFile(skill.location, "utf-8");
        } catch {
          console.log(`[Skill] ❌ 激活失败：无法读取 ${skill.location}`);
          return { error: `无法读取技能文件：${name}` };
        }
        const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();

        const resources = await u
          .db("o_skillList")
          .distinct("o_skillList.path")
          .innerJoin("o_skillAttribution", "o_skillList.id", "o_skillAttribution.skillId")
          .where("o_skillList.state", 1)
          .andWhere("o_skillAttribution.attribution", mainSkillName);

        console.log("%c Line:120 🌮 resources", "background:#b03734", resources);

        activated.add(name);
        console.log(`[Skill] 📖 已激活：${name}（${body.length} 字符，${resources.length} 资源）`);
        let content = "";
        content = `<skill_content name="${name}">\n`;
        content += body + "\n\n";
        content += `Skill directory: ${skill.baseDir}\n`;
        content += "相对路径基于此技能目录解析，使用 read_skill_file 工具读取资源文件。\n";
        if (resources.length > 0) {
          content += "\n<skill_resources>\n";
          for (const { path } of resources) {
            content += `  <file>${path}</file>\n`;
          }
          content += "</skill_resources>\n";
        }
        content += "\n<skill_tools_guide>\n";
        content += "- read_skill_file：读取上方 skill_resources 中列出的资源文件。\n";
        content += "- discover_skill_docs：当上方资源不足以完成任务时，使用关键词检索更多相关文档。传入与当前任务相关的关键词列表即可获取推荐。\n";
        content += "</skill_tools_guide>\n";
        content += "</skill_content>";
        console.log("%c Line:133 🍊 content", "background:#2eafb0", content);
        return { content };
      },
    }),
    discover_skill_docs: tool({
      description: "根据关键词主动发现全部技能文档（MD），返回相关度排序的推荐列表。适用于技能指令中未明确指定资源文件但需要补充信息的场景。",
      inputSchema: z.object({
        keywords: z.array(z.string().max(100)).min(1).max(20).describe("用于检索技能文档的关键词列表"),
        topK: z.number().int().min(1).max(20).default(5).describe("返回推荐文档数量"),
      }),
      execute: async ({ keywords, topK }) => {
        const queryText = keywords.join(" ");
        const queryVec = await getEmbedding(queryText);

        const activeRows = await u.db("o_skillList").where("state", 1).whereNotNull("embedding").select();
        const scored = activeRows
          .map((row) => {
            const emb = JSON.parse(row.embedding!) as number[];
            return {
              name: row.name,
              filePath: row.path,
              type: row.type,
              description: row.description,
              score: cosineSimilarity(queryVec, emb),
            };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, topK);

        console.log(`[Skill] ✅ discover_skill_docs 返回 ${scored.length} 条推荐`);
        return { recommendations: scored };
      },
    }),
    read_skill_file: tool({
      description: "读取已激活技能目录下的资源文件。传入 activate_skill 返回的 skill_resources 中的文件路径。",
      inputSchema: z.object({
        skillName: z.string().describe("技能名称"),
        filePath: z.string().describe("资源文件的相对路径，来自 activate_skill 返回的 skill_resources"),
      }),
      execute: async ({ skillName, filePath: relPath }) => {
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
