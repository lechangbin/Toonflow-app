import "../type";

export function buildReqBody(input: VideoConfig, config: AIConfig) {
  const requestBody: any = {
    model: config.model,
    ...(input.imageBase64 && input.imageBase64.length ? { images: input.imageBase64 } : {}),
    prompt: input.prompt,
    duration: input.duration,
    resolution: input.resolution,
    audio: input?.audio ?? false,
    aspect_ratio: input.aspectRatio,
    off_peak: false,
  };

  return requestBody;
}

export function buildReqUrl(baseUrl: string): { requestUrl: string; queryUrl: string } {
  return {
    requestUrl: `${baseUrl}/v1/video/generations`,
    queryUrl: `${baseUrl}/v1/video/generations/{id}`,
  };
}
