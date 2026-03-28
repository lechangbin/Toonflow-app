import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import fs from "fs/promises";
import path from "path";

const router = express.Router();

const resolveSkillFilePath = (type: string, relativePath: string) => {
  const normalizedPath = (relativePath || "").replace(/\\/g, "/");
  const isPrefixedReferencePath = normalizedPath.startsWith("references/");
  if (type === "references" && !isPrefixedReferencePath) {
    return path.join(u.getPath(["skills", "references"]), normalizedPath);
  }
  return path.join(u.getPath("skills"), normalizedPath);
};

export default router.post(
  "/",
  validateFields({
    content: z.string(),
  }),
  async (req, res) => {
    const { content } = req.body;
    const result = await u.Ai.Text("universalAi").invoke({
      system:
        "你是一个文档摘要助手。根据给定的文档内容生成一句简洁的中文描述（不超过100字），概括文档的核心主题和用途。只输出描述文本，不要添加任何前缀或格式。",
      messages: [{ role: "user", content: `内容：\n${content}` }],
    });
    const description = result.text.trim();
    res.status(200).send(success(description));
  },
);
