import express from "express";
import u from "@/utils";
import { getDatabaseRuntime } from "@/database";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getDefaultConfiguredVendor } from "@/vendor";
import { parseVendorModelName } from "@/vendor";
import { applyLegacyImageReferenceConversion, normalizeHttpResult } from "@/utils/imageGeneration";

const router = express.Router();

type AssetType = "role" | "scene" | "tool";

interface AssetTypeConfig {
  label: string;
  taskClass: string;
  dir: string;
  promptTitle: string;
  promptEnd: string;
}

const assetTypeConfig: Record<AssetType, AssetTypeConfig> = {
  role: {
    label: "角色",
    taskClass: "角色图生成",
    dir: "role",
    promptTitle: "角色标准四视图",
    promptEnd: "人物角色四视图",
  },
  scene: {
    label: "场景",
    taskClass: "场景图生成",
    dir: "scene",
    promptTitle: "标准场景图",
    promptEnd: "标准场景图",
  },
  tool: {
    label: "道具",
    taskClass: "道具图生成",
    dir: "props",
    promptTitle: "标准道具图",
    promptEnd: "标准道具图",
  },
};

// ─── 构建生成提示词 ──────────────────────────────────────────

function buildPrompt(cfg: AssetTypeConfig, artStyle: string, name: string, prompt: string): string {
  return `
    请根据以下参数生成${cfg.promptTitle}：

    **基础参数：**
    - 画风风格: ${artStyle || "未指定"}

    **${cfg.label}设定：**
    - 名称:${name},
    - 提示词:${prompt},

    请严格按照系统规范生成${cfg.promptEnd}。
  `;
}

// ─── 生成资产图片 ────────────────────────────────────────────

const requestSchema = {
  projectId: z.number(),
  model: z.string(),
  resolution: z.string(),
  id: z.number(),
  type: z.enum(["role", "scene", "tool", "storyboard"]),
  name: z.string(),
  prompt: z.string(),
  base64: z.string().optional().nullable(),
};

export default router.post("/", validateFields(requestSchema), async (req, res) => {
  const { projectId, model, resolution, id, type, name, prompt, base64 } = req.body;

  // 1. 查询项目 & 获取类型配置
  const project = await getDatabaseRuntime().work(async (db) => {
    return await db("o_project").where("id", projectId).select("artStyle", "type", "intro").first();
  });
  if (!project) return res.status(500).send(success({ message: "项目为空" }));

  const cfg = assetTypeConfig[type as AssetType];
  if (!cfg) return res.status(400).send(error("不支持的类型"));

  // 2. 创建图片占位记录
  const [imageId] = await getDatabaseRuntime().work(async (db) => {
    const [insertedId] = await db("o_image").insert({
      type,
      state: "生成中",
      assetsId: id,
      model: model.split(/:(.+)/)[1],
      resolution,
    });
    await db("o_assets").where("id", id).update({ imageId: insertedId });
    return [insertedId];
  });

  // 3. 准备生成参数
  const imagePath = `/${projectId}/${cfg.dir}/${uuidv4()}.jpg`;
  const userPrompt = buildPrompt(cfg, project.artStyle!, name, prompt);
  const describe = `生成${cfg.label}图，名称：${name}，提示词：${prompt}`;
  const relatedObjects = { id, projectId, type: cfg.label };

  try {
    const { vendorId, modelId } = parseVendorModelName(model);
    const taskRecord = await u.task(projectId, cfg.taskClass, modelId, {
      describe,
      content: JSON.stringify(relatedObjects),
    });
    let result: string;
    try {
      const vendor = getDefaultConfiguredVendor();
      const { version } = await vendor.inspectVendor(vendorId);
      const input = applyLegacyImageReferenceConversion(version, {
        prompt: userPrompt,
        referenceList: base64 ? [{ type: "image", base64 }] : [],
        size: resolution,
        aspectRatio: "16:9",
      });
      result = await vendor.generateImage({ target: { vendorId, modelId }, input });
      result = await normalizeHttpResult(result);
    } catch (e) {
      taskRecord(-1, u.error(e).message);
      throw new Error(u.error(e).message);
    }
    taskRecord(1);
    await u.oss.writeFile(imagePath, result);
    // 5. 更新记录 & 返回结果
    const imageData = await getDatabaseRuntime().work(async (db) => {
      return await db("o_image").where("id", imageId).select("*").first();
    });
    if (!imageData) return res.status(500).send("资产已被删除");
    if (imageData.state === "生成失败") return;
    await getDatabaseRuntime().work(async (db) => {
      await db("o_image").where("id", imageId).update({
        state: "已完成",
        filePath: imagePath,
        type,
        model: modelId,
        resolution,
      });
    });

    const path = await u.oss.getSmallImageUrl(imagePath);
    await getDatabaseRuntime().work(async (db) => {
      await db("o_assets").where("id", id).update({ imageId });
    });

    return res.status(200).send(success({ path, assetsId: id }));
  } catch (e) {
    await getDatabaseRuntime().work(async (db) => {
      await db("o_image").where("id", imageId).update({ state: "生成失败", errorReason: u.error(e).message });
    });
    return res.status(400).send(error(u.error(e).message || "图片生成失败"));
  }
});
