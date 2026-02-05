import modelList from "./video/modelList";

interface ValidateResult {
  owned: (typeof modelList)[number];
  images: string[];
  hasStartEndType: boolean;
}

/**
 * 校验视频生成配置与模型是否匹配
 * @param input 视频配置
 * @param config AI配置
 * @param customOwned 自定义模型配置（如果传入则跳过模型查找）
 */
export const validateVideoConfig = (input: VideoConfig, config: AIConfig, customOwned?: (typeof modelList)[number]): ValidateResult => {
  if (!config.model) throw new Error("缺少Model名称");

  const owned = customOwned ?? modelList.find((m) => m.model === config.model);
  if (!owned) throw new Error(`不支持的模型: ${config.model}`);

  const images = input.imageBase64 ?? [];

  // 校验图片数量与模型类型是否匹配
  const hasTextType = owned.type.includes("text");
  const hasSingleImageType = owned.type.includes("singleImage");
  const hasStartEndType = owned.type.some((t) => ["startEndRequired", "endFrameOptional", "startFrameOptional"].includes(t));
  const hasMultiImageType = owned.type.includes("multiImage");
  const hasReferenceType = owned.type.includes("reference");

  if (images.length === 0 && !hasTextType) {
    throw new Error(`模型 ${config.model} 不支持纯文本生成，需要提供图片`);
  }
  if (images.length === 1 && !hasSingleImageType && !hasStartEndType && !hasReferenceType) {
    throw new Error(`模型 ${config.model} 不支持单图模式`);
  }
  if (images.length === 2 && !hasStartEndType) {
    throw new Error(`模型 ${config.model} 不支持首尾帧模式`);
  }
  if (images.length > 2 && !hasMultiImageType) {
    throw new Error(`模型 ${config.model} 不支持多图模式`);
  }

  // 校验duration和resolution是否在支持范围内
  const validDurationResolution = owned.durationResolutionMap.some(
    (map) => map.duration.includes(input.duration) && map.resolution.includes(input.resolution),
  );
  if (!validDurationResolution) {
    const supportedDurations = [...new Set(owned.durationResolutionMap.flatMap((m) => m.duration))].sort((a, b) => a - b);
    const supportedResolutions = [...new Set(owned.durationResolutionMap.flatMap((m) => m.resolution))];
    throw new Error(
      `不支持的duration(${input.duration})或resolution(${input.resolution})组合。` +
        `支持的duration: ${supportedDurations.join(", ")}，支持的resolution: ${supportedResolutions.join(", ")}`,
    );
  }

  // 校验音频设置
  if (input.audio && !owned.audio) {
    throw new Error(`模型 ${config.model} 不支持生成音频`);
  }

  return { owned, images, hasStartEndType };
};

export const pollTask = async (
  queryFn: () => Promise<{ completed: boolean; imageUrl?: string; error?: string }>,
  maxAttempts = 500,
  interval = 2000,
): Promise<string> => {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    const { completed, imageUrl, error } = await queryFn();
    if (error) throw new Error(error);
    if (completed && imageUrl) return imageUrl;
  }
  throw new Error(`任务轮询超时，已尝试 ${maxAttempts} 次`);
};
