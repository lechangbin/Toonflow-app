import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getEmbedding } from "@/utils/agent/embedding";

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

const buildRelativePath = (type: string, fileName: string) => {
  return type === "references" ? path.posix.join("references", fileName) : fileName;
};

const resolveSkillFilePath = (relativePath: string) => {
  return path.join(u.getPath("skills"), relativePath.replace(/\\/g, "/"));
};

const resolveState = (description: string, attributions: string[]) => {
  if (!description.trim()) return -1;
  if (attributions.length === 0) return -2;
  return 1;
};

export default router.post(
  "/",
  validateFields({
    id: z.string().min(1),
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    content: z.string().optional(),
    attributions: z.array(z.string()).optional(),
  }),
  async (req, res) => {
    try {
      const { id, name, description, content, attributions } = req.body;
      const current = await u.db("o_skillList").where("id", id).first();

      if (!current) {
        return res.status(404).send(error("技能不存在"));
      }

      const finalDescription = description ?? "";
      const finalContent = content ?? "";
      const rawAttributions = Array.isArray(attributions) ? attributions : [];
      const finalAttributions = Array.from(
        new Set(rawAttributions.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)),
      );
      const fileName = buildSkillFileName(name);
      const relativePath = buildRelativePath(current.type, fileName);
      const nextId = crypto.createHash("md5").update(relativePath).digest("hex");
      const md5 = crypto.createHash("md5").update(finalContent).digest("hex");
      const oldFilePath = resolveSkillFilePath(current.path);
      const newFilePath = resolveSkillFilePath(relativePath);
      const now = Date.now();

      if (nextId !== id) {
        const conflict = await u.db("o_skillList").where("id", nextId).first();
        if (conflict) {
          return res.status(400).send(error("技能名称冲突，请使用其他名称"));
        }
      }

      await fs.mkdir(path.dirname(newFilePath), { recursive: true });
      if (oldFilePath !== newFilePath) {
        try {
          await fs.rename(oldFilePath, newFilePath);
        } catch {
          // 文件不存在时直接按新路径写入即可
        }
      }
      await fs.writeFile(newFilePath, finalContent, "utf-8");

      if (nextId !== id) {
        await u.db("o_skillAttribution").where("skillId", id).update({ skillId: nextId });
      }

      await u
        .db("o_skillList")
        .where("id", id)
        .update({
          id: nextId,
          path: relativePath,
          name: path.basename(fileName, ".md"),
          description: finalDescription,
          md5,
          updateTime: now,
          state: resolveState(finalDescription, finalAttributions),
        });

      if (finalDescription && !current.embedding) {
        const embedding = await getEmbedding(finalDescription);
        await u
          .db("o_skillList")
          .where("id", nextId)
          .update({ embedding: JSON.stringify(embedding) });
      }

      await u.db("o_skillAttribution").where("skillId", nextId).delete();
      if (finalAttributions.length > 0) {
        await u.db("o_skillAttribution").insert(
          finalAttributions.map((attribution: string) => ({
            skillId: nextId,
            attribution,
          })),
        );
      }

      res.status(200).send(success("更新技能成功"));
    } catch (err: any) {
      console.log(err);
      res.status(400).send(error(err?.message || "更新技能失败"));
    }
  },
);
