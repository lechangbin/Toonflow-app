import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const router = express.Router();

const buildSkillFileName = (name: string) => {
  const trimmed = name.trim();
  const fileName = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
  const normalized = fileName.replace(/\\/g, "/");
  if (!normalized || normalized.includes("/")) {
    throw new Error("技能名称不能包含路径分隔符");
  }
  return normalized;
};

const buildRelativePath = (type: "main" | "references", fileName: string) => {
  return type === "references" ? path.posix.join("references", fileName) : fileName;
};

const resolveSkillFilePath = (relativePath: string) => {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  if (normalizedPath.startsWith("references/")) {
    return path.join(u.getPath("skills"), normalizedPath);
  }
  return path.join(u.getPath("skills"), normalizedPath);
};

const resolveState = (description: string, attributions: string[]) => {
  if (!description.trim()) return -1;
  if (attributions.length === 0) return -2;
  return 1;
};

export default router.post(
  "/",
  validateFields({
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    content: z.string().optional(),
    attributions: z.array(z.string()).optional(),
    type: z.enum(["main", "references"]).optional(),
  }),
  async (req, res) => {
    try {
      const { name, description, content, attributions, type } = req.body;
      const finalType: "main" | "references" = type === "main" ? "main" : "references";
      const finalDescription = description ?? "";
      const finalContent = content ?? "";
      const rawAttributions = Array.isArray(attributions) ? attributions : [];
      const finalAttributions = Array.from(
        new Set(rawAttributions.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)),
      );
      const fileName = buildSkillFileName(name);
      const relativePath = buildRelativePath(finalType, fileName);
      const skillId = crypto.createHash("md5").update(relativePath).digest("hex");
      const md5 = crypto.createHash("md5").update(finalContent).digest("hex");
      const filePath = resolveSkillFilePath(relativePath);
      const now = Date.now();

      const existed = await u.db("o_skillList").where("id", skillId).first();
      if (existed) {
        return res.status(400).send(error("技能已存在，请使用其他名称"));
      }

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, finalContent, "utf-8");

      await u.db("o_skillList").insert({
        id: skillId,
        md5,
        path: relativePath,
        name: path.basename(fileName, ".md"),
        description: finalDescription,
        embedding: null,
        type: finalType,
        createTime: now,
        updateTime: now,
        state: resolveState(finalDescription, finalAttributions),
      });

      if (finalAttributions.length > 0) {
        await u.db("o_skillAttribution").insert(
          finalAttributions.map((attribution: string) => ({
            skillId,
            attribution,
          })),
        );
      }

      res.status(200).send(success("新增技能成功"));
    } catch (err: any) {
      console.log(err);
      res.status(400).send(error(err?.message || "新增技能失败"));
    }
  },
);
