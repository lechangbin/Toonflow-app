import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 获取用户
export default router.post(
  "/",
  validateFields({
    shortTermMemoryLength: z.number(), //短期记忆长度
    searchTopK: z.number(), //搜索记忆条数
    similarityThreshold: z.number(), //记忆相似度阈值
  }),
  async (req, res) => {
    const { shortTermMemoryLength, searchTopK, similarityThreshold } = req.body;
    await u.db("o_setting").where("key", "shortTermMemoryLength").update({
      value: shortTermMemoryLength,
    });
    await u.db("o_setting").where("key", "searchTopK").update({
      value: searchTopK,
    });
    await u.db("o_setting").where("key", "similarityThreshold").update({
      value: similarityThreshold,
    });
    res.status(200).send(success("保存设置成功"));
  },
);
