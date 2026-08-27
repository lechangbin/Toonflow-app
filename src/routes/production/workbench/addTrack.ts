import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    duration: z.number().optional(),
  }),
  async (req, res) => {
    const { projectId, scriptId, duration } = req.body;
    const data = await u.db("o_project").where("id", projectId).first();
    if (!data?.videoVendorId || !data.videoModelId || !data.videoCapabilityId || !data.videoOutputPresetId) {
      throw new Error("项目尚未配置完整的 Video Capability 默认值");
    }
    const models = await u.vendor.getModelList(data.videoVendorId);
    const model = models.find((item: any) => item.type === "video" && item.modelName === data.videoModelId);
    const capability = model?.capabilities?.find((item: any) => item.id === data.videoCapabilityId);
    const preset = capability?.outputPresets?.find((item: any) => item.id === data.videoOutputPresetId);
    if (!preset || !preset.aspectRatios.includes(data.videoRatio)) {
      throw new Error("项目默认 Video Capability/Output Preset 已失效");
    }
    const defaultDuration = preset.durations.kind === "values" ? preset.durations.values[0] : preset.durations.min;
    const selectedDuration = duration ?? defaultDuration;
    const durationAllowed =
      preset.durations.kind === "values"
        ? preset.durations.values.includes(selectedDuration)
        : selectedDuration >= preset.durations.min &&
          selectedDuration <= preset.durations.max &&
          (selectedDuration - preset.durations.min) % preset.durations.step === 0;
    if (!durationAllowed) throw new Error(`时长 ${selectedDuration}s 不属于 Output Preset ${preset.id}`);
    const trackId = Date.now()
    await u.db("o_videoTrack").insert({
      id: trackId,
      projectId,
      scriptId,
      duration: selectedDuration,
      vendorId: data.videoVendorId,
      modelId: data.videoModelId,
      capabilityId: data.videoCapabilityId,
      outputSelection: JSON.stringify({
        presetId: data.videoOutputPresetId,
        duration: selectedDuration,
        resolution: preset.resolution,
        aspectRatio: data.videoRatio,
      }),
    });
    res.status(200).send(success(trackId));
  },
);
