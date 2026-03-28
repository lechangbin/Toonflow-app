import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import fs from "fs";
import path from "path";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
const router = express.Router();

// 新增视觉手册
export default router.post(
  "/",
  validateFields({
    name: z.string(),
    image: z.string(),
    data: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
        data: z.string(),
      }),
    ),
  }),
  async (req, res) => {
    try {
      const { name, image, data } = req.body as {
        name: string;
        image: string;
        data: { label: string; value: string; data: string }[];
      };

      const mainPath = u.getPath(["skills", "art_prompts", name]);

      // 将 image 写入 mainPath/images/image 文件（无后缀）
      if (image) {
        const imagesDir = path.join(mainPath, "images");
        if (!fs.existsSync(imagesDir)) {
          fs.mkdirSync(imagesDir, { recursive: true });
        }
        fs.writeFileSync(path.join(imagesDir, "image"), image, "utf-8");
      }

      // 字段映射表（与 getVisualManual 保持一致）
      const DATA_MAP: { label: string; value: string; subDir?: string }[] = [
        { label: "README", value: "README" },
        { label: "前缀", value: "prefix" },
        { label: "角色", value: "art_character", subDir: "art_prompt" },
        { label: "角色衍生", value: "art_character_derivative", subDir: "art_prompt" },
        { label: "道具", value: "art_prop", subDir: "art_prompt" },
        { label: "道具衍生", value: "art_prop_derivative", subDir: "art_prompt" },
        { label: "场景", value: "art_scene", subDir: "art_prompt" },
        { label: "场景衍生", value: "art_scene_derivative", subDir: "art_prompt" },
        { label: "分镜", value: "art_storyboard", subDir: "art_prompt" },
        { label: "分镜视频", value: "art_storyboard_video", subDir: "art_prompt" },
        { label: "技法-导演规划", value: "director_planning", subDir: "driector_skills" },
        { label: "技法-分镜表设计", value: "director_storyboard_table", subDir: "driector_skills" },
      ];

      // 根据 DATA_MAP 构建 value -> subDir 的映射
      const SUB_DIR_MAP = new Map(DATA_MAP.map(({ value, subDir }) => [value, subDir ?? ""]));

      // 合法的 value 值集合，用于校验
      const VALID_KEYS = new Set(DATA_MAP.map(({ value }) => value));

      for (const item of data) {
        if (!VALID_KEYS.has(item.value)) continue;

        const subDir = SUB_DIR_MAP.get(item.value)!;
        const dirArr = subDir ? [mainPath, subDir] : [mainPath];
        const filePath = u.getPath([...dirArr, `${item.value}.md`]);

        const fileDir = path.dirname(filePath);
        // 目录不存在时递归创建
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        fs.writeFileSync(filePath, item.data, "utf-8");
      }

      res.status(200).send(success());
    } catch (err) {
      res.status(500).send({ error: String(err) });
    }
  },
);
