import express from "express";
import pLimit from "p-limit";
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

const requestSchema = {
  projectId: z.number(),
  model: z.string(),
  resolution: z.string(),
  concurrentCount: z.number().int().min(1).optional(),
  items: z.array(
    z.object({
      id: z.number(),
      type: z.enum(["role", "scene", "tool", "storyboard"]),
      name: z.string(),
      prompt: z.string(),
      base64: z.string().optional().nullable(),
    }),
  ),
};

export default router.post("/", validateFields(requestSchema), async (req, res) => {
  const { projectId, model, resolution, concurrentCount, items } = req.body;

  // 1. 查询项目
  const project = await getDatabaseRuntime().work(async (db) => {
    return await db("o_project").where("id", projectId).select("artStyle", "type", "intro").first();
  });
  if (!project) return res.status(500).send(error("项目为空"));

  // 2. 逐条插入 o_image 占位记录，收集 imageId 列表
  const totalNovelId: number[] = await getDatabaseRuntime().work(async (db) => {
    const ids: number[] = [];
    for (const item of items) {
      const [imageId] = await db("o_image").insert({
        type: item.type,
        state: "生成中",
        assetsId: item.id,
      });
      await db("o_assets").where("id", item.id).update({ imageId });
      ids.push(imageId);
    }
    return ids;
  });

  // 3. 后台异步并发生成，不阻塞响应
  const limit = pLimit(concurrentCount ?? 1);

  const tasks = items.map((item: { id: number; type: string; name: string; prompt: string; base64: string | null | undefined }, index: number) =>
    limit(async () => {
      const imageId = totalNovelId[index];
      const data = await getDatabaseRuntime().work(async (db) => {
        return await db("o_image").where("id", imageId).select("state").first();
      });
      if (data?.state === "生成失败") {
        return;
      }
      const cfg = assetTypeConfig[item.type as AssetType];
      if (!cfg) return;

      await getDatabaseRuntime().work(async (db) => {
        await db("o_assets").where("id", item.id).update({ imageId });
      });

      const imagePath = `/${projectId}/${cfg.dir}/${uuidv4()}.jpg`;
      const userPrompt = buildPrompt(cfg, project.artStyle ?? "", item.name, item.prompt);
      const describe = `生成${cfg.label}图，名称：${item.name}，提示词：${item.prompt}`;
      const relatedObjects = { id: item.id, projectId, type: cfg.label };
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
            referenceList: item.base64 ? [{ base64: item.base64, type: "image" }] : [],
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
        void u.oss.writeFile(imagePath, result);

        const imageData = await getDatabaseRuntime().work(async (db) => {
          return await db("o_image").where("id", imageId).select("*").first();
        });
        if (!imageData) return res.status(500).send("资产已被删除");
        if (!imageData) return;
        if (imageData.state === "生成失败") return;
        await getDatabaseRuntime().work(async (db) => {
          await db("o_image").where("id", imageId).update({
            state: "已完成",
            filePath: imagePath,
            type: item.type,
            model: modelId,
            resolution,
          });
        });

        await getDatabaseRuntime().work(async (db) => {
          await db("o_assets").where("id", item.id).update({ imageId });
        });
      } catch (e: any) {
        await getDatabaseRuntime().work(async (db) => {
          await db("o_image").where("id", imageId).update({ state: "生成失败", errorReason: u.error(e).message });
        });
      }
    }),
  );

  // 后台执行，不等待结果
  Promise.all(tasks).catch(() => {});

  return res.status(200).send(success({ total: items.length }));
});
