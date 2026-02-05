import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    userId: z.number(),
  }),
  async (req, res) => {
    const { userId } = req.body;

    const settingData = await u.db("t_setting").select("*");

    const configData = await u.db("t_config").where("userId", userId).select("*");

    const parsedData = settingData.map((item) => ({
      ...item,
      imageModel: configData.find((i) => i.type == "image"),
      languageModel: configData.find((i) => i.type == "text"),
      videoModel: configData.filter((i) => i.type == "video").filter(Boolean),
    }));

    res.status(200).send(success(parsedData));
  },
);
