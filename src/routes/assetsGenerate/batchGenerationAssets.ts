import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { error, success } from "@/lib/responseFormat";
const router = express.Router();

const assetItemSchema = z.object({
  id: z.number(),
  type: z.enum(["role", "scene", "tool", "storyboard"]),
  projectId: z.number(),
  name: z.string(),
  base64: z.string().optional().nullable(),
  prompt: z.string(),
  model: z.custom<`${number}:${string}`>(
    (val) => typeof val === "string" && /^\d+:.+$/.test(val),
    { message: "model 格式应为 {vendorId}:{modelName}，例如 1:modelName" },
  ),
  resolution: z.enum(["1K", "2K", "4K"]),
});

type AssetItem = z.infer<typeof assetItemSchema>;

// 处理单个资产图片生成
async function generateSingleAsset(item: AssetItem) {
  const { id, type, projectId, base64, prompt, name, model, resolution } = item;

  const project = await u.db("o_project").where("id", projectId).select("artStyle", "type", "intro").first();
  if (!project) throw new Error(`项目 ${projectId} 不存在`);

  const role = (await u.getPrompts("role-generateImage")) ?? "";
  const scene = (await u.getPrompts("scene-generateImage")) ?? "";
  const tool = (await u.getPrompts("tool-generateImage")) ?? "";

  let systemPrompt = "";
  let userPrompt = "";

  if (type === "role") {
    systemPrompt = role;
    userPrompt = `
    请根据以下参数生成角色标准四视图：

    **基础参数：**
    - 画风风格: ${project?.artStyle || "未指定"}

    **角色设定：**
    - 名称:${name},
    - 提示词:${prompt},

    请严格按照系统规范生成人物角色四视图。
    `;
  } else if (type === "scene") {
    systemPrompt = scene;
    userPrompt = `
    请根据以下参数生成标准场景图：

    **基础参数：**
    - 画风风格: ${project?.artStyle || "未指定"}

    **场景设定：**
    - 名称:${name},
    - 提示词:${prompt},

    请严格按照系统规范生成标准场景图。
    `;
  } else if (type === "tool") {
    systemPrompt = tool;
    userPrompt = `
    请根据以下参数生成标准道具图：

    **基础参数：**
    - 画风风格: ${project?.artStyle || "未指定"}

    **道具设定：**
    - 名称:${name},
    - 提示词:${prompt},

    请严格按照系统规范生成标准道具图。
    `;
  }

  const [imageId] = await u.db("o_image").insert({
    type,
    state: "生成中",
    assetsId: id,
  });

  try {
    let imagePath: string;
    let insertType: string;

    if (type === "role") {
      insertType = "role";
      imagePath = `/${projectId}/role/${uuidv4()}.jpg`;
    } else if (type === "scene") {
      insertType = "scene";
      imagePath = `/${projectId}/scene/${uuidv4()}.jpg`;
    } else {
      insertType = "tool";
      imagePath = `/${projectId}/props/${uuidv4()}.jpg`;
    }

    const aiImage = u.Ai.Image(model);
    await aiImage.run({
      systemPrompt,
      prompt: userPrompt,
      imageBase64: base64 ? [base64] : [],
      size: resolution,
      aspectRatio: "16:9",
    });
    aiImage.save(imagePath);

    const imageData = await u.db("o_image").where("id", imageId).select("*").first();
    const modelData = model.split(":")[1];

    if (!imageData) {
      throw new Error("资产已被删除");
    }

    await u.db("o_image").where("id", imageId).update({
      state: "生成成功",
      filePath: imagePath,
      type: insertType,
      model: modelData,
      resolution,
    });

    const path = await u.oss.getFileUrl(imagePath);
    await u.db("o_assets").where("id", id).update({ imageId });

    return { success: true, path, assetsId: id };
  } catch (e) {
    await u.db("o_image").where("id", imageId).update({ state: "生成失败" });
    throw e;
  }
}

// 批量生成资产图片
export default router.post("/", async (req, res) => {
  // 校验请求体
  const bodySchema = z.object({
    concurrentCount: z.number().int().min(1).default(3),
    items: z.array(assetItemSchema).min(1),
  });

  const parseResult = bodySchema.safeParse(req.body);
  if (!parseResult.success) {
    const errors = parseResult.error.issues.map((issue) => `字段 ${issue.path.join(".")} ${issue.message}`);
    return res.status(400).json({ message: "参数错误", errors });
  }

  const { concurrentCount, items } = parseResult.data;
  const results: { assetsId: number; success: boolean; path?: string; message?: string }[] = [];

  // 按并发数分批执行
  for (let i = 0; i < items.length; i += concurrentCount) {
    const batch = items.slice(i, i + concurrentCount);
    const batchResults = await Promise.allSettled(batch.map((item) => generateSingleAsset(item)));

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const item = batch[j];
      if (result.status === "fulfilled") {
        results.push({ assetsId: item.id, success: true, path: result.value.path });
      } else {
        const msg = u.error(result.reason).message || "图片生成失败";
        results.push({ assetsId: item.id, success: false, message: msg });
      }
    }
  }

  return res.status(200).send(success(results));
});
