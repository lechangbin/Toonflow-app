import { generateText, streamText, wrapLanguageModel, stepCountIs } from "ai";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import axios from "axios";
import { transform } from "sucrase";
import u from "@/utils";

type AiType = "scriptAgent" | "productionAgent" | "universalAgent";
type FnName = "textRequest" | "imageRequest" | "videoRequest" | "ttsRequest";

const AiTypeValues: AiType[] = ["scriptAgent", "productionAgent", "universalAgent"];
async function resolveModelName(value: AiType | `${string}:${string}`): Promise<`${string}:${string}`> {
  if (AiTypeValues.includes(value as AiType)) {
    const agentDeployData = await u.db("o_agentDeploy").where("key", value).first();
    if (!agentDeployData?.modelName) throw new Error(`${value}模型未配置`);
    return agentDeployData.modelName as `${number}:${string}`;
  }
  return value as `${number}:${string}`;
}

async function getVendorTemplateFn(fnName: FnName, modelName: `${string}:${string}`) {
  const [id, name] = modelName.split(":");
  const vendorConfigData = await u.db("o_vendorConfig").where("id", id).first();
  if (!vendorConfigData) throw new Error(`未找到供应商配置 id=${id}`);
  const modelList = JSON.parse(vendorConfigData.models ?? "[]");
  const selectedModel = modelList.find((i: any) => i.modelName == name);
  if (!selectedModel) throw new Error(`未找到模型 ${name} id=${id}`);
  const jsCode = transform(vendorConfigData.code!, { transforms: ["typescript"] }).code;
  const fn = u.vm(jsCode)[fnName];
  if (!fn) throw new Error(`未找到供应商配置中的函数 ${fnName} id=${id}`);
  if (fnName == "textRequest") return fn(selectedModel);
  else return <T>(input: T) => fn(input, selectedModel);
}

async function withTaskRecord<T>(
  modelKey: AiType | `${string}:${string}`,
  taskClass: string,
  describe: string,
  relatedObjects: string,
  projectId: number,
  fn: (modelName: `${string}:${string}`) => Promise<T>,
): Promise<T> {
  const modelName = await resolveModelName(modelKey);
  const [id, model] = modelName.split(":");
  const taskRecord = await u.task(projectId, taskClass, model, { describe: describe, content: relatedObjects });
  try {
    const result = await fn(modelName);
    taskRecord(1);
    return result;
  } catch (e) {
    taskRecord(-1, u.error(e).message);
    throw e;
  }
}

async function urlToBase64(url: string): Promise<string> {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  const base64 = Buffer.from(res.data).toString("base64");
  return `${base64}`;
}

class AiText {
  private AiType: AiType | `${string}:${string}`;
  constructor(AiType: AiType | `${string}:${string}`) {
    this.AiType = AiType;
  }
  async invoke(input: Omit<Parameters<typeof generateText>[0], "model">) {
    const switchAiDevTool = await u.db("o_setting").where("key", "switchAiDevTool").first();
    const modelName = await resolveModelName(this.AiType);
    return generateText({
      ...(input.tools && { stopWhen: stepCountIs(Object.keys(input.tools).length * 50) }),
      ...input,
      model:
        switchAiDevTool?.value === "1"
          ? wrapLanguageModel({
              model: await getVendorTemplateFn("textRequest", modelName),
              middleware: devToolsMiddleware(),
            })
          : await getVendorTemplateFn("textRequest", modelName),
    } as Parameters<typeof generateText>[0]);
  }
  async stream(input: Omit<Parameters<typeof streamText>[0], "model">) {
    const switchAiDevTool = await u.db("o_setting").where("key", "switchAiDevTool").first();
    const modelName = await resolveModelName(this.AiType);
    return streamText({
      ...(input.tools && { stopWhen: stepCountIs(Object.keys(input.tools).length * 50) }),
      ...input,
      model:
        switchAiDevTool?.value == "1"
          ? wrapLanguageModel({
              model: await getVendorTemplateFn("textRequest", modelName),
              middleware: devToolsMiddleware(),
            })
          : await getVendorTemplateFn("textRequest", modelName),
    } as Parameters<typeof streamText>[0]);
  }
}

interface ImageConfig {
  prompt: string; //图片提示词
  imageBase64: string[]; //输入的图片提示词
  size: "1K" | "2K" | "4K"; // 图片尺寸
  aspectRatio: `${number}:${number}`; // 长宽比
  taskClass: string; // 任务分类
  describe: string; // 任务描述
  relatedObjects: string; // 相关对象信息，便于后续分析和追踪
  projectId: number; // 项目ID
}

class AiImage {
  private key: `${string}:${string}`;
  private result: string = "";
  constructor(key: `${string}:${string}`) {
    this.key = key;
  }
  async run(input: ImageConfig) {
    return withTaskRecord(this.key, input.taskClass, input.describe, input.relatedObjects, input.projectId, async (modelName) => {
      const fn = await getVendorTemplateFn("imageRequest", modelName);
      this.result = await fn(input);
      console.log("%c Line:119 🌽 this.result", "background:#ed9ec7", this.result);
      if (this.result.startsWith("http")) this.result = await urlToBase64(this.result);
      return this;
    });
  }
  async save(path: string) {
    await u.oss.writeFile(path, this.result);
    return this;
  }
}
interface VideoConfig {
  projectId: number; // 项目ID
  prompt: string; //视频提示词
  imageBase64: string[]; //输入的图片提示词
  aspectRatio: `${number}:${number}`; // 长宽比
  mode: string; //模式
  duration: number; // 视频时长，单位秒
  resolution: string; // 视频分辨率
  audio: boolean; // 是否需要配音
  taskClass: string; // 任务分类
  describe: string; // 任务描述
  relatedObjects: string; // 相关对象信息，便于后续分析和追踪
}

class AiVideo {
  private key: `${string}:${string}`;
  private result: string = "";
  constructor(key: `${string}:${string}`) {
    this.key = key;
  }
  async run(input: VideoConfig) {
    return withTaskRecord(this.key, input.taskClass, input.describe, input.relatedObjects, input.projectId, async (modelName) => {
      const fn = await getVendorTemplateFn("videoRequest", modelName);
      this.result = await fn(input);
      if (this.result.startsWith("http")) this.result = await urlToBase64(this.result);
      return this;
    });
  }
  async save(path: string) {
    await u.oss.writeFile(path, this.result);
    return this;
  }
}
class AiAudio {
  private key: `${string}:${string}`;
  private result: string = "";
  constructor(key: `${string}:${string}`) {
    this.key = key;
  }
  async run(input: VideoConfig) {
    return withTaskRecord(this.key, input.taskClass, input.describe, input.relatedObjects, input.projectId, async (modelName) => {
      const fn = await getVendorTemplateFn("ttsRequest", modelName);
      this.result = await fn(input);
      if (this.result.startsWith("http")) this.result = await urlToBase64(this.result);
      return this;
    });
  }
  async save(path: string) {
    await u.oss.writeFile(path, this.result);
    return this;
  }
}

export default {
  Text: (AiType: AiType | `${string}:${string}`) => new AiText(AiType),
  Image: (key: `${string}:${string}`) => new AiImage(key),
  Video: (key: `${string}:${string}`) => new AiVideo(key),
  Audio: (key: `${string}:${string}`) => new AiAudio(key),
};
