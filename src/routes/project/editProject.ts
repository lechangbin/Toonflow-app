import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增项目
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string(),
    intro: z.string(),
    type: z.string(),
    artStyle: z.string(),
    directorManual: z.string(),
    videoRatio: z.string(),
    imageModel: z.string(),
    videoVendorId: z.string(),
    videoModelId: z.string(),
    videoCapabilityId: z.string(),
    videoOutputPresetId: z.string(),
    projectType: z.string(),
    imageQuality: z.string(),
  }),
  async (req, res) => {
    const {
      id,
      name,
      intro,
      type,
      artStyle,
      videoRatio,
      directorManual,
      imageModel,
      videoVendorId,
      videoModelId,
      videoCapabilityId,
      videoOutputPresetId,
      imageQuality,
      projectType,
    } = req.body;

    const videoModels = await u.vendor.getModelList(videoVendorId);
    const videoModel = videoModels.find((model: any) => model.modelName === videoModelId && model.type === "video");
    const capability = videoModel?.capabilities?.find((item: any) => item.id === videoCapabilityId);
    const outputPreset = capability?.outputPresets?.find((preset: any) => preset.id === videoOutputPresetId);
    if (!outputPreset || !outputPreset.aspectRatios.includes(videoRatio)) {
      throw new Error("项目 Video Vendor/Model/Capability/Output Preset 默认值无效");
    }

    await u.db("o_project").where("id", id).update({
      name,
      intro,
      type,
      artStyle,
      videoRatio,
      directorManual,
      imageModel,
      videoVendorId,
      videoModelId,
      videoCapabilityId,
      videoOutputPresetId,
      imageQuality,
      projectType,
    });

    res.status(200).send(success({ message: "编辑项目成功" }));
  },
);
