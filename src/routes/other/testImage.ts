import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
const router = express.Router();

// 检查语言模型
export default router.post(
  "/",
  validateFields({
    modelName: z.string().optional(),
    apiKey: z.string(),
    baseURL: z.string().optional(),
    manufacturer: z.string(),
  }),
  async (req, res) => {
    const { modelName, apiKey, baseURL, manufacturer } = req.body;
    try {
      const image = await u.ai.image({
        prompt: "生成16：9 四宫格图片，第一宫格是一只猫，第二宫格是一只狗， 第三宫格是一只老虎，第四宫格是猪。保证宫格图片标准等分",
        imageBase64: [],
        aspectRatio: "16:9",
        size: "1K",
      });
      res.status(200).send(success(image));
    } catch (e: any) {
      return res.status(500).send(error(e?.response?.data ?? e?.message ?? "生成失败"));
    }

    // try {
    //   const contentStr = await u.ai.generateImage(
    //     {
    //       prompt: "2D cat",
    //       imageBase64: [],
    //       aspectRatio: "16:9",
    //       size: "1K",
    //     },
    //     {
    //       model: modelName,
    //       apiKey,
    //       baseURL,
    //       manufacturer,
    //     },
    //   );
    //   res.status(200).send(success(contentStr));
    // } catch (err: any) {
    //   const message = err?.response?.data?.error?.message || err?.error?.message || "模型调用失败";
    //   res.status(500).send(error(message));
    // }
  },
);
