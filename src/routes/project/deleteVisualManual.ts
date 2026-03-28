import express from "express";
import u from "@/utils";
import fs from "fs";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 删除视觉手册
export default router.post(
  "/",
  validateFields({
    name: z.string(),
  }),
  async (req, res) => {
    try {
      const { name } = req.body as { name: string };

      // 安全校验：不允许包含路径分隔符、纯数字，防止越级删除或误删项目目录
      if (name.includes("/") || name.includes("\\") || name === "." || name === ".." || /^\d+$/.test(name)) {
        res.status(400).send(error("名称不能包含路径分隔符或为纯数字"));
        return;
      }

      const artPromptsDir = u.getPath(["skills", "art_prompts", name]);

      // 1. 删除 skills/art_prompts 下的同名文件夹
      if (fs.existsSync(artPromptsDir)) {
        fs.rmSync(artPromptsDir, { recursive: true, force: true });
        // 2. 删除 oss 下的同名文件夹（存放图片）
        try {
          await u.oss.deleteDirectory(name);
        } catch {
          // oss 下不存在该目录则忽略
        }
      }

      res.status(200).send(success({ message: "删除成功" }));
    } catch (err) {
      res.status(500).send(error(u.error(err).message || "删除失败"));
    }
  },
);
