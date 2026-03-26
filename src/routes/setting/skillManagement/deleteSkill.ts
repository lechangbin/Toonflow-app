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
    id: z.string().min(1),
  }),
  async (req, res) => {
    try {
      const { id } = req.body;
      const skill = await u.db("o_skillList").where("id", id).first();

      if (!skill) {
        return res.status(404).send(error("技能不存在"));
      }

      const filePath = resolveSkillFilePath(skill.type, skill.path || "");
      await u.db("o_skillList").where("id", id).delete();

      try {
        await fs.unlink(filePath);
      } catch {
        // 文件不存在时可忽略，数据库记录已删除
      }

      res.status(200).send(success("删除技能成功"));
    } catch (err: any) {
      console.log(err);
      res.status(400).send(error(err?.message || "删除技能失败"));
    }
  },
);
