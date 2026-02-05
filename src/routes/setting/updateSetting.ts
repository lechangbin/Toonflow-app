import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 修改全局配置
export default router.post(
  "/",
  validateFields({
    userId: z.number(),
    imageModel: z.object().optional(),
    videoModel: z.array(z.object()).optional(),
    languageModel: z.object().optional(),
    name: z.string().optional(),
    password: z.string().optional(),
  }),
  async (req, res) => {
    const { userId, imageModel, videoModel, languageModel, name, password } = req.body;

    await u
      .db("t_setting")
      .where("userId", userId)
      .update({
        imageModel: JSON.stringify(imageModel),
        languageModel: JSON.stringify(languageModel),
      });

    if (videoModel) {
      await u.db("t_config").where("type", "video").delete();

      for (const item of videoModel) {
        await u.db("t_config").insert({
          type: "video",
          name: item.model,
          model: item.model,
          apiKey: item.apiKey,
          baseUrl: item.baseUrl,
          createTime: Date.now(),
          userId,
          manufacturer: item.manufacturer,
        });
      }
    }
    if (languageModel) {
      await u.db("t_config").where("type", "text").delete();
      await u.db("t_config").insert({
        type: "text",
        name: languageModel.model,
        model: languageModel.model,
        apiKey: languageModel.apiKey,
        baseUrl: languageModel.baseUrl,
        createTime: Date.now(),
        userId,
        manufacturer: languageModel.manufacturer,
      });
    }
    if (imageModel) {
      await u.db("t_config").where("type", "image").delete();
      await u.db("t_config").insert({
        type: "image",
        name: imageModel.model,
        model: imageModel.model,
        apiKey: imageModel.apiKey,
        baseUrl: imageModel.baseUrl,
        createTime: Date.now(),
        userId,
        manufacturer: imageModel.manufacturer,
      });
    }
    await u.db("t_user").where("id", userId).update({
      name,
      password,
    });

    res.status(200).send(success({ message: "修改全局配置成功" }));
  },
);
