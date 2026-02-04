import "./type";
import u from "@/utils";
import modelList from "./modelList";
import axios from "axios";

import volcengine from "./owned/volcengine";
import kling from "./owned/kling";


interface AIConfig {
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

const urlToBase64 = async (url: string): Promise<string> => {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  const base64 = Buffer.from(res.data).toString("base64");
  const mimeType = res.headers["content-type"] || "image/png";
  return `data:${mimeType};base64,${base64}`;
};

const modelInstance = {
  gemini: null,
  volcengine: volcengine,
  kling: kling,
  vidu: null,
  runninghub: null,
  apimart: null,
} as const;

export default async (input: ImageConfig, config?: AIConfig) => {
  const sqlTextModelConfig = await u.getConfig("image");
  const { model, apiKey, baseURL, manufacturer } = { ...sqlTextModelConfig, ...config };
  const manufacturerFn = modelInstance[manufacturer as keyof typeof modelInstance];
  if (!manufacturerFn) if (!manufacturerFn) throw new Error("不支持的图片厂商");
  const owned = modelList.find((m) => m.model === model);
  if (!owned) throw new Error("不支持的模型");

  let imageUrl = await manufacturerFn(input, { model, apiKey, baseURL });
  if (!input.resType) input.resType = "b64";
  if (input.resType === "b64" && imageUrl.startsWith("http")) imageUrl = await urlToBase64(imageUrl);
  return input;
};
