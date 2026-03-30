import express from "express";
import u from "@/utils";
import { z } from "zod";
import getPath from "@/utils/getPath";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import fs from "fs";
import path from "path";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    model: z.string(),
    storyboardId: z.number(),
  }),
  async (req, res) => {
    const { model, storyboardId } = req.body;

    //测试数据
    //拿到分镜以及对应的资产信息
    const data = await u
      .db("o_storyboard")
      .leftJoin("o_assets2Storyboard", "storyboardId.id", "o_assets2Storyboard.storyboardId")
      .leftJoin("o_assets", "o_assets2Storyboard.assetId", "o_assets.id")
      .where("o_storyboard.id", storyboardId)
      .select("o_storyboard.*", "o_assets.name as assetName", "o_assets.type as assetType", "o_assets.prompt as assetPrompt");
    res.status(200).send(success({ message: "" }));
  },
);
