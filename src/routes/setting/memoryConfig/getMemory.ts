import express from "express";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
const router = express.Router();

export default router.get("/", async (req, res) => {
  const settingData = await u.db("o_setting").whereIn("key", ["shortTermMemoryLength", "searchTopK", "similarityThreshold"]);

  if (!settingData) return res.status(400).send(error(`获取记忆配置失败`));
  const memoryObj: Record<string, number> = {};

  settingData.forEach((i) => {
    if (i.key && i.value) {
      memoryObj[i.key] = Number(i.value);
    }
  });

  res.status(200).send(success({ ...memoryObj }));
});
