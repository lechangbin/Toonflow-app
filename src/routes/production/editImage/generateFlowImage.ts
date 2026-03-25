import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import axios from "axios";
const router = express.Router();
async function getImageBase64ForId(imageId: string | number) {
  const imagePath = await u
    .db("o_image")
    .select("filePath")
    .where({ id: Number(imageId) })
    .first();

  if (!imagePath || !imagePath.filePath) return ""; // 未找到图片路径
  const url = await u.oss.getFileUrl(imagePath.filePath);
  return await urlToBase64(url);
}

async function urlToBase64(imageUrl: string): Promise<string> {
  const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
  const contentType = response.headers["content-type"] || "image/png";
  const base64 = Buffer.from(response.data, "binary").toString("base64");
  return `data:${contentType};base64,${base64}`;
}
// 将图片ID和指令转换为base64数组和替换后的指令
async function convertDirectiveAndImages(images: Record<string, string>, directive: string) {
  // step1: 列出所有别名
  const aliasList = Object.keys(images);
  // step2: 在指令中提取所有 @别名出现
  const aliasRegex = /@[\u4e00-\u9fa5\w]+/g;
  const referencedAliases = directive.match(aliasRegex) || [];
  // step3: 检查别名
  for (const alias of referencedAliases) {
    if (!(alias in images)) {
      throw new Error(`您引用了不存在的图片：${alias}`);
    }
  }
  // step4: 构建别名与顺序编号映射
  const aliasToIndex: Record<string, number> = {};
  aliasList.forEach((alias, i) => {
    aliasToIndex[alias] = i + 1;
  });
  // step5: 替换指令中的别名为"图N"
  let prompt = directive;
  for (const [alias, idx] of Object.entries(aliasToIndex)) {
    // 转义alias可能含特殊字符
    const reg = new RegExp(alias.replace(/([.*+?^${}()|\[\]\/\\])/g, "\\$1"), "g");
    prompt = prompt.replace(reg, `图${idx}`);
  }
  // step6: 依次获取图片 base64 内容（区分id或者本身就是base64）
  const base64Images: string[] = [];

  for (const imageVal of Object.values(images)) {
    // 判断是否为base64串
    const isBase64 = typeof imageVal === "string" && /^data:image\//.test(imageVal);
    if (isBase64) {
      base64Images.push(imageVal);
    } else if (typeof imageVal === "number") {
      const base64 = await getImageBase64ForId(imageVal);
      base64Images.push(base64);
    } else if (imageVal.includes("http")) {
      const base64 = await urlToBase64(imageVal);
      base64Images.push(base64);
    }
  }
  return {
    prompt,
    images: base64Images,
  };
}
export default router.post(
  "/",
  validateFields({
    model: z.string(),
    references: z.object().optional(),
    quality: z.string(),
    ratio: z.string(),
    prompt: z.string(),
    projectId: z.number(),
    type: z.enum(["role", "scene", "storyboard", "clip", "tool"]),
  }),
  async (req, res) => {
    const { model, references = {}, quality, ratio, prompt, projectId, type } = req.body;
    const { prompt: userPrompt, images: base64Images } = await convertDirectiveAndImages(references, prompt);
    const imageClass = await u.Ai.Image(model).run({
      prompt: userPrompt,
      imageBase64: base64Images,
      size: quality,
      aspectRatio: ratio,
      taskClass: "分镜生成",
      describe: "生成分镜图片",
      relatedObjects: JSON.stringify(req.body),
      projectId: projectId,
    });
    const savePath = `${projectId}/${type}/${u.uuid()}.jpg`;
    await imageClass.save(savePath);

    const url = await u.oss.getFileUrl(savePath);
    return res.status(200).send(success({ url }));
  },
);
