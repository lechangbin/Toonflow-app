import { generateText, streamText, Output, stepCountIs, ModelMessage, LanguageModel, Tool, GenerateTextResult } from "ai";
import { parse } from "best-effort-json-parser";
import axios from "axios";
import { transform } from "sucrase";
import u from "@/utils";

type AiType = "scriptAgent" | "productionAgent" | "assetsAi" | "polishingAi" | "ttsDubbing" | "eventExtractAi";
type FnName = "textRequest" | "imageRequest" | "videoRequest" | "ttsRequest";

const AiTypeValues: AiType[] = ["scriptAgent", "productionAgent", "assetsAi", "polishingAi", "ttsDubbing", "eventExtractAi"];
async function getVendorTemplateFn(fnName: FnName, value: AiType | `${number}:${string}`) {
  let id, modelName;
  const isAgent = AiTypeValues.includes(value as AiType);
  if (isAgent) {
    const agentDeployData = await u.db("o_agentDeploy").where("key", value).first();
    if (!agentDeployData?.modelName) throw new Error(`${value}模型未配置`);
    [id, modelName] = agentDeployData.modelName.split(":");
  } else {
    [id, modelName] = value.split(":");
  }
  const vendorConfigData = await u.db("o_vendorConfig").where("id", id).first();
  if (!vendorConfigData) throw new Error(`未找到供应商配置 id=${id}`);
  const modelList = JSON.parse(vendorConfigData.models ?? "[]");
  const selectedModel = modelList.find((i: any) => i.modelName == modelName);
  if (!selectedModel) throw new Error(`未找到模型 ${modelName} id=${id}`);
  const jsCode = transform(vendorConfigData.code!, { transforms: ["typescript"] }).code;
  const fn = u.vm(jsCode)[fnName];
  if (!fn) throw new Error(`未找到供应商配置中的函数 ${fnName} id=${id}`);
  if (fnName == "textRequest") return fn(selectedModel);
  else return <T>(input: T) => fn(input, selectedModel);
}

async function urlToBase64(url: string): Promise<string> {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  const base64 = Buffer.from(res.data).toString("base64");
  return `${base64}`;
}

class AiText {
  private AiType: AiType | `${number}:${string}`;
  constructor(AiType: AiType | `${number}:${string}`) {
    this.AiType = AiType;
  }
  async invoke(input: Omit<Parameters<typeof generateText>[0], "model">) {
    return generateText({
      ...(input.tools && { stopWhen: stepCountIs(Object.keys(input.tools).length * 5) }),
      ...input,
      model: await getVendorTemplateFn("textRequest", this.AiType),
    } as Parameters<typeof generateText>[0]);
  }
  async stream(input: Omit<Parameters<typeof streamText>[0], "model">) {
    return streamText({
      ...(input.tools && { stopWhen: stepCountIs(Object.keys(input.tools).length * 5) }),
      ...input,
      model: await getVendorTemplateFn("textRequest", this.AiType),
    } as Parameters<typeof streamText>[0]);
  }
}

interface ImageConfig {
  systemPrompt?: string; // 系统提示词
  prompt: string; //图片提示词
  imageBase64: string[]; //输入的图片提示词
  size: "1K" | "2K" | "4K"; // 图片尺寸
  aspectRatio: `${number}:${number}`; // 长宽比
}

class AiImage {
  private key: `${number}:${string}`;
  private result: string = "";
  constructor(key: `${number}:${string}`) {
    this.key = key;
  }
  async run(input: ImageConfig) {
    const fn = await getVendorTemplateFn("imageRequest", this.key);
    this.result = await fn(input);
    if (this.result.startsWith("http")) this.result = await urlToBase64(this.result);

    return this;
  }
  async save(path: string) {
    await u.oss.writeFile(path, this.result);
    return this;
  }
}
class AiVideo {
  private key: `${number}:${string}`;
  private result: string = "";
  constructor(key: `${number}:${string}`) {
    this.key = key;
  }
  async run(input: ImageConfig) {
    const fn = await getVendorTemplateFn("videoRequest", this.key);
    this.result = await fn(input);
    if (this.result.startsWith("http")) this.result = await urlToBase64(this.result);
    return this;
  }
  async save(path: string) {
    await u.oss.writeFile(path, this.result);
    return this;
  }
}
class AiAudio {
  private key: `${number}:${string}`;
  private result: string = "";
  constructor(key: `${number}:${string}`) {
    this.key = key;
  }
  async run(input: ImageConfig) {
    const fn = await getVendorTemplateFn("ttsRequest", this.key);
    this.result = await fn(input);
    if (this.result.startsWith("http")) this.result = await urlToBase64(this.result);
    return this;
  }
  async save(path: string) {
    await u.oss.writeFile(path, this.result);
    return this;
  }
}

export default {
  Text: (AiType: AiType | `${number}:${string}`) => new AiText(AiType),
  Image: (key: `${number}:${string}`) => new AiImage(key),
  Video: (key: `${number}:${string}`) => new AiVideo(key),
  Audio: (key: `${number}:${string}`) => new AiAudio(key),
};
